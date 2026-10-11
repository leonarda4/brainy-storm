import json
import asyncio
import hashlib
import time
from pathlib import Path
from typing import List, Optional, Dict, Any
from .artifact_store import IdeaArtifactStore
from .config import IDEA_ARTIFACTS_DIR, IDEAS_FILE, TRANSCRIPT_FILE
from .models import Idea
from .stance_participants import clean_participant_attributions
from .thumbnail import GENERATOR, STYLE_REVISION, art_direction_for, generation_palette_for, source_hash

_storage_lock = asyncio.Lock()


class StorageManager:
    """Handles async-safe read/write operations to data/ideas.json and transcript.txt."""

    def __init__(
        self,
        ideas_path: Path = IDEAS_FILE,
        transcript_path: Path = TRANSCRIPT_FILE,
        artifacts_path: Optional[Path] = None,
    ):
        self.ideas_path = Path(ideas_path)
        self.transcript_path = Path(transcript_path)
        if artifacts_path is None:
            artifacts_path = (
                IDEA_ARTIFACTS_DIR
                if self.ideas_path.resolve() == Path(IDEAS_FILE).resolve()
                else self.ideas_path.parent / "ideas"
            )
        self.artifacts = IdeaArtifactStore(artifacts_path)
        self._ensure_files()

    def _ensure_files(self):
        self.ideas_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.ideas_path.exists():
            with open(self.ideas_path, "w", encoding="utf-8") as f:
                json.dump({"ideas": []}, f, indent=2)
        if not self.transcript_path.exists():
            with open(self.transcript_path, "w", encoding="utf-8") as f:
                f.write("")

    async def get_all_ideas(self) -> List[Idea]:
        async with _storage_lock:
            return self._read_ideas_sync()

    def _read_ideas_sync(self) -> List[Idea]:
        if not self.ideas_path.exists():
            return []
        try:
            with open(self.ideas_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if not content:
                    return []
                data = json.loads(content)
        except (json.JSONDecodeError, OSError):
            return []

        raw_list = data.get("ideas", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        ideas = []
        for item in raw_list:
            if isinstance(item, dict):
                # Ensure each idea has an id if missing
                if "id" not in item:
                    item["id"] = item.get("title", "").lower().replace(" ", "-") or "idea-1"
                try:
                    ideas.append(Idea(**item))
                except Exception:
                    # Fallback for minimal data
                    ideas.append(Idea(
                        id=item.get("id", "idea-1"),
                        title=item.get("title", "Untitled"),
                        summary=item.get("summary", ""),
                        thumbnail=item.get("thumbnail")
                    ))
        return ideas

    async def get_idea(self, identifier: str) -> Optional[Idea]:
        ideas = await self.get_all_ideas()
        identifier_lower = identifier.lower().strip()
        for idea in ideas:
            if idea.id.lower() == identifier_lower or idea.title.lower().strip() == identifier_lower:
                return idea
        return None

    async def save_or_update_idea(self, idea: Idea) -> Idea:
        async with _storage_lock:
            ideas = self._read_ideas_sync()
            found = False
            for i, existing in enumerate(ideas):
                if existing.id == idea.id:
                    ideas[i] = idea
                    found = True
                    break
            if not found:
                ideas.append(idea)

            self._write_ideas_sync(ideas)
            return idea

    def _read_discussion_focus_sync(self) -> Dict[str, Optional[str]]:
        try:
            data = json.loads(self.ideas_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        focus = data.get("discussion_focus", {}) if isinstance(data, dict) else {}
        return {session: idea_id for session, idea_id in focus.items()
                if isinstance(idea_id, str) or idea_id is None} if isinstance(focus, dict) else {}

    async def set_discussion_focus(self, session_id: str, idea_id: Optional[str]) -> None:
        async with _storage_lock:
            ideas = self._read_ideas_sync()
            if any(idea.id == idea_id and idea.session_id != session_id for idea in ideas):
                raise ValueError("The idea belongs to another storm.")
            focus = self._read_discussion_focus_sync()
            if session_id in focus and focus[session_id] == idea_id:
                return
            focus[session_id] = idea_id
            self._write_ideas_sync(ideas, focus)

    async def materialize_all(self) -> int:
        """Refresh all per-idea files, including stable thumbnails."""
        async with _storage_lock:
            ideas = self._read_ideas_sync()
            self._write_ideas_sync(ideas)
            return len(ideas)

    async def update_thumbnail(
        self, idea_id: str, expected_source: str, generation: dict,
        svg: Optional[str] = None,
    ) -> bool:
        """Commit only thumbnail fields against the latest idea, never a stale copy."""
        async with _storage_lock:
            ideas = self._read_ideas_sync()
            idea = next((item for item in ideas if item.id == idea_id), None)
            if idea is None or source_hash(idea) != expected_source:
                return False
            self.artifacts.ensure_thumbnail(idea)
            folder = self.artifacts.folder_for(idea_id)
            metadata = self.artifacts.thumbnail_metadata(idea_id)
            if svg is not None:
                self.artifacts._write_text(folder / "thumbnail.svg", svg)
                metadata = {
                    "generator": GENERATOR,
                    "style_revision": STYLE_REVISION,
                    "source_hash": expected_source,
                    "title": idea.title,
                    "palette": ["#000000", *generation_palette_for(idea)],
                    "art_direction": art_direction_for(idea),
                    "width": 800, "height": 400,
                    "generated_at": time.time(),
                    "svg_hash": hashlib.sha256(svg.encode()).hexdigest()[:16],
                }
            metadata["generation"] = generation
            self.artifacts._write_json(folder / "thumbnail.json", metadata)
            if svg is not None:
                self._write_ideas_sync(ideas)
            return True

    def _write_ideas_sync(self, ideas: List[Idea], discussion_focus: Optional[Dict[str, Optional[str]]] = None):
        # Preserve current focus when late enrichment saves an older Idea copy,
        # and when the focused idea is first created by its queued job.
        if discussion_focus is None:
            discussion_focus = self._read_discussion_focus_sync()
        for idea in ideas:
            idea.proponents = clean_participant_attributions(idea.proponents)
            idea.opponents = clean_participant_attributions(idea.opponents)
            if idea.session_id in discussion_focus:
                idea.is_currently_discussed = discussion_focus[idea.session_id] == idea.id
            self.artifacts.ensure_thumbnail(idea)
        data = {
            "discussion_focus": discussion_focus,
            "ideas": [idea.model_dump(exclude_none=False) for idea in ideas]
        }
        # Atomic write via temporary file
        temp_file = self.ideas_path.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        temp_file.replace(self.ideas_path)
        for idea in ideas:
            self.artifacts.write(idea)

    async def get_transcript(self) -> str:
        if not self.transcript_path.exists():
            return ""
        try:
            with open(self.transcript_path, "r", encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    async def append_transcript(self, text: str):
        async with _storage_lock:
            with open(self.transcript_path, "a", encoding="utf-8") as f:
                f.write(text.strip() + "\n")


storage = StorageManager()
