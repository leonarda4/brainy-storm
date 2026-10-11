import html
import hashlib
import json
import random
import re
from pathlib import Path
from typing import Iterable, Optional

from .models import ArchitectureEnrichment, Idea, WorkflowEnrichment


class IdeaArtifactStore:
    """Materialize each idea into human- and machine-readable files."""

    def __init__(self, root: Path):
        self.root = Path(root)

    @staticmethod
    def _safe_id(idea_id: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", idea_id).strip("._")
        return safe or "idea"

    def folder_for(self, idea_id: str) -> Path:
        return self.root / self._safe_id(idea_id)

    def record_for(self, idea_id: str) -> Path:
        return self.root / f"{self._safe_id(idea_id)}.json"

    def ensure_thumbnail(self, idea: Idea) -> Path:
        """Keep finished artwork; create an instant placeholder only if missing."""
        folder = self.folder_for(idea.id)
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / "thumbnail.svg"
        metadata_path = folder / "thumbnail.json"
        metadata = self.thumbnail_metadata(idea.id)
        if not target.is_file() or not metadata:
            seed_text = str(idea.metadata.get("thumbnail_seed") or idea.id)
            svg, metadata = self._thumbnail_svg(seed_text)
            self._write_text(target, svg)
            self._write_json(metadata_path, metadata)
        idea.thumbnail = f"/ideas/{idea.id}/artifacts/thumbnail.svg"
        if metadata.get("svg_hash"):
            idea.thumbnail += f"?v={metadata['svg_hash']}"
        return target

    def thumbnail_metadata(self, idea_id: str) -> dict:
        try:
            data = json.loads((self.folder_for(idea_id) / "thumbnail.json").read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    @staticmethod
    def _write_text(path: Path, value: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(value, encoding="utf-8")
        temporary.replace(path)

    def _write_json(self, path: Path, value):
        self._write_text(
            path,
            json.dumps(value, indent=2, ensure_ascii=False) + "\n",
        )

    def write(self, idea: Idea) -> Path:
        folder = self.folder_for(idea.id)
        folder.mkdir(parents=True, exist_ok=True)
        self.ensure_thumbnail(idea)

        complete_record = idea.model_dump(exclude_none=False)
        self._write_json(self.record_for(idea.id), complete_record)
        self._write_json(folder / "idea.json", complete_record)
        self._write_text(folder / "raw-body.txt", idea.raw_body or "")
        self._write_json(
            folder / "transcript-segments.json",
            [segment.model_dump() for segment in idea.transcript_segments],
        )
        self._write_text(folder / "summary.md", self._summary_markdown(idea))

        if idea.pros_cons:
            self._write_json(folder / "pros-cons.json", idea.pros_cons.model_dump())
            self._write_text(folder / "pros-cons.md", self._pros_cons_markdown(idea))
            self._write_text(
                folder / "assumptions-open-questions.md",
                self._questions_markdown(idea),
            )
        if idea.competitors:
            self._write_json(folder / "competitors.json", idea.competitors.model_dump())
            self._write_text(folder / "competitors.md", self._competitors_markdown(idea))
        if idea.workflow:
            self._write_json(folder / "workflow.json", idea.workflow.model_dump())
            self._write_text(folder / "workflow.mmd", idea.workflow.mermaid_code or "")
            self._write_text(folder / "workflow.svg", self._workflow_svg(idea.workflow))
        if idea.systemGraph:
            self._write_json(
                folder / "system-architecture.json", idea.systemGraph.model_dump()
            )
            self._write_text(
                folder / "system-architecture.mmd", idea.systemGraph.mermaid_code
            )
            self._write_text(
                folder / "system-architecture.svg",
                self._architecture_svg(idea.systemGraph),
            )

        files = sorted(path.name for path in folder.iterdir() if path.is_file())
        self._write_json(folder / "manifest.json", {
            "id": idea.id,
            "title": idea.title,
            "current_status": idea.status,
            "content_version": idea.content_version,
            "enriched_version": idea.enriched_version,
            "updated_at": idea.updated_at,
            "files": files,
        })
        return folder

    @staticmethod
    def _summary_markdown(idea: Idea) -> str:
        takeaway = str(idea.metadata.get("key_takeaway", "")).strip()
        lines = [f"# {idea.title}", "", f"- ID: `{idea.id}`", f"- Status: `{idea.status}`", "", "## Summary", "", idea.summary or "Not generated."]
        if takeaway:
            lines.extend(["", "## Key takeaway", "", takeaway])
        return "\n".join(lines) + "\n"

    @staticmethod
    def _pros_cons_markdown(idea: Idea) -> str:
        result = idea.pros_cons
        lines = [
            "# Pros & Cons Identified from Body (Categorized & Sorted)",
            "",
            "*Sorted by impact and risk.*",
            "",
            result.summary or "",
        ]
        for heading, items, suffix in (
            ("Pros Voiced in Discussion", result.pros, "Impact"),
            ("Cons Voiced in Discussion", result.cons, "Risk"),
        ):
            lines.extend(["", f"## {heading}"])
            for item in items:
                lines.extend([
                    "",
                    f"### {item.category} — {item.severity_or_impact} {suffix}",
                    "",
                    item.point,
                ])
                if item.source_context:
                    lines.extend(["", f"*\"{item.source_context}\"*"])
        return "\n".join(lines).strip() + "\n"

    @staticmethod
    def _questions_markdown(idea: Idea) -> str:
        result = idea.pros_cons
        lines = ["# Assumptions and Open Questions", "", "## Assumptions"]
        lines.extend(f"- {item}" for item in result.assumptions)
        if not result.assumptions:
            lines.append("- None identified.")
        lines.extend(["", "## Open questions"])
        lines.extend(f"- {item}" for item in result.open_questions)
        if not result.open_questions:
            lines.append("- None identified.")
        return "\n".join(lines) + "\n"

    @staticmethod
    def _competitors_markdown(idea: Idea) -> str:
        result = idea.competitors
        lines = [
            "# Competitors Discovered via Google Search",
            "",
            "*Live Web Grounded*" if result.groundingSources else "*No grounding sources were returned.*",
            "",
            result.summary or "",
        ]
        for competitor in result.competitors:
            lines.extend([
                "",
                f"## {competitor.name}",
                "",
                f"**Founded:** {competitor.yearOfFounding or 'Unknown'}",
                "",
                "### Their Idea",
                competitor.idea or competitor.summary,
                "",
                "### Short Bio",
                competitor.shortBio or competitor.summary,
                "",
                "### How We Differ",
                competitor.howWeDiffer or competitor.differentiator,
            ])
        lines.extend(["", "## Market landscape", "", result.market_landscape, "", "## Our positioning", "", result.our_positioning])
        if result.groundingSources:
            lines.extend(["", "## Sources"])
            lines.extend(f"- {source}" for source in result.groundingSources)
        return "\n".join(lines).strip() + "\n"

    @staticmethod
    def _svg_document(width: int, height: int, body: str, title: str) -> str:
        return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
<rect width="100%" height="100%" fill="#f8fafc"/>
<style>.title{{font:700 22px Arial;fill:#0f172a}}.box{{fill:#fff;stroke:#6366f1;stroke-width:2}}.label{{font:600 14px Arial;fill:#0f172a}}.small{{font:12px Arial;fill:#475569}}.edge{{stroke:#64748b;stroke-width:2;fill:none}}</style>
<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#64748b"/></marker></defs>
<text x="32" y="36" class="title">{html.escape(title)}</text>
{body}
</svg>'''

    def _workflow_svg(self, workflow: WorkflowEnrichment) -> str:
        steps = workflow.steps or [workflow.summary or "Workflow not generated"]
        width = 1000
        height = max(220, 105 * len(steps) + 90)
        body = []
        for index, step in enumerate(steps):
            y = 70 + index * 105
            if index:
                body.append(f'<line x1="500" y1="{y - 35}" x2="500" y2="{y}" class="edge" marker-end="url(#arrow)"/>')
            wrapped = self._wrap(step, 92)
            body.append(f'<rect x="90" y="{y}" width="820" height="70" rx="12" class="box"/>')
            for line_index, line in enumerate(wrapped[:2]):
                body.append(f'<text x="115" y="{y + 28 + line_index * 20}" class="label">{html.escape(line)}</text>')
        return self._svg_document(width, height, "\n".join(body), "Workflow")

    def _architecture_svg(self, architecture: ArchitectureEnrichment) -> str:
        nodes = architecture.nodes
        width = 1200
        columns = 3
        rows = max(1, (len(nodes) + columns - 1) // columns)
        height = max(350, rows * 180 + 100)
        positions = {}
        for index, node in enumerate(nodes):
            col, row = index % columns, index // columns
            positions[node.id] = (70 + col * 380, 75 + row * 180)
        body = []
        for edge in architecture.edges:
            if edge.source not in positions or edge.target not in positions:
                continue
            sx, sy = positions[edge.source]
            tx, ty = positions[edge.target]
            body.append(f'<line x1="{sx + 280}" y1="{sy + 50}" x2="{tx}" y2="{ty + 50}" class="edge" marker-end="url(#arrow)"/>')
            if edge.label:
                body.append(f'<text x="{(sx + tx + 280) / 2}" y="{(sy + ty) / 2 + 38}" class="small">{html.escape(edge.label)}</text>')
        for node in nodes:
            x, y = positions[node.id]
            body.append(f'<rect x="{x}" y="{y}" width="280" height="100" rx="12" class="box"/>')
            body.append(f'<text x="{x + 18}" y="{y + 30}" class="label">{html.escape(node.label)}</text>')
            for line_index, line in enumerate(self._wrap(node.description, 38)[:2]):
                body.append(f'<text x="{x + 18}" y="{y + 55 + line_index * 17}" class="small">{html.escape(line)}</text>')
        return self._svg_document(width, height, "\n".join(body), "System Architecture")

    @staticmethod
    def _thumbnail_svg(seed_text: str):
        seed = int(hashlib.sha256(seed_text.encode("utf-8")).hexdigest()[:16], 16)
        rng = random.Random(seed)
        # Eight supporting brand colors; blue stays reserved for CTA controls.
        brand_colors = (
            "#ff7146", "#f47aff", "#9ff6ee", "#f4ff61", "#a83cf4",
            "#ffe600", "#9da51a", "#ff4545",
        )
        palettes = [
            pair
            for color in brand_colors
            for pair in (("#000000", color), (color, "#000000"))
        ]
        background, foreground = rng.choice(palettes)
        shape = rng.choice(["scallops", "stacked"])
        canvas_width, canvas_height = 720, 360

        # Use the same two silhouettes and proportions as frontend/BrandShape.
        # A 360 × 180 viewBox keeps the artwork identical at any output size.
        if shape == "scallops":
            artwork = '<path d="M-20 180V120Q12 30 44 130Q77-42 110 101Q145-97 180 76Q217-43 248 115Q278 9 310 137Q340 56 380 137V180Z"/>'
        else:
            artwork = '''<ellipse cx="180" cy="50" rx="108" ry="18"/>
<ellipse cx="180" cy="76" rx="130" ry="22"/>
<ellipse cx="180" cy="110" rx="153" ry="27"/>
<ellipse cx="180" cy="151" rx="178" ry="33"/>
<path d="M0 150h360v40H0z"/>'''

        # Keep most compositions clean; occasional dots add a third brand color.
        accent = None
        dot = ""
        if rng.randrange(3) == 0:
            accent = rng.choice([
                color for color in brand_colors
                if color not in (background, foreground)
            ])
            dot_x = rng.choice((54, 306))
            dot = f'<circle cx="{dot_x}" cy="29" r="9" fill="{accent}"/>'

        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{canvas_width}" height="{canvas_height}" viewBox="0 0 360 180" preserveAspectRatio="xMidYMid slice">
<rect width="360" height="180" fill="{background}"/>
<g fill="{foreground}">{artwork}</g>
{dot}
</svg>'''
        return svg, {
            "generator": "deterministic-abstract-v4",
            "seed": seed_text,
            "shape": shape,
            "palette": {
                "background": background,
                "foreground": foreground,
                "accent": accent,
            },
            "width": canvas_width,
            "height": canvas_height,
        }

    @staticmethod
    def _wrap(text: str, length: int) -> Iterable[str]:
        words = str(text).split()
        lines = []
        current = []
        for word in words:
            if current and len(" ".join(current + [word])) > length:
                lines.append(" ".join(current))
                current = [word]
            else:
                current.append(word)
        if current:
            lines.append(" ".join(current))
        return lines
