import asyncio
import time
from collections import defaultdict
from typing import Dict, Iterable, List, Optional

from .models import EnrichmentJob, Idea, RoutedIdeaMatch, TranscriptSegment
from .orchestrator import orchestrator
from .storage import storage


class EnrichmentJobQueue:
    """In-process queue with FIFO ordering per idea and parallelism across ideas.

    This is deliberately small and test-friendly. A production deployment can
    preserve the same HTTP contract while replacing this class with Redis,
    Celery, Pub/Sub, or another durable queue.
    """

    def __init__(self):
        self._jobs: Dict[str, EnrichmentJob] = {}
        self._queue_lock = asyncio.Lock()
        self._idea_locks: Dict[str, asyncio.Lock] = {}

    def _idea_lock(self, idea_id: str) -> asyncio.Lock:
        lock = self._idea_locks.get(idea_id)
        if lock is None:
            lock = asyncio.Lock()
            self._idea_locks[idea_id] = lock
        return lock

    async def enqueue(
        self,
        chunk_id: str,
        source_transcript: str,
        match: RoutedIdeaMatch,
    ) -> EnrichmentJob:
        tools = match.tools
        if tools is None:
            tools = (
                ["summary", "pros_cons", "workflow", "architecture", "competitors"]
                if match.is_new
                else ["summary", "pros_cons"]
            )
        job = EnrichmentJob(
            session_id=match.session_id,
            chunk_id=chunk_id,
            idea_id=match.idea_id.strip(),
            is_new=match.is_new,
            title=match.title.strip() if match.title else None,
            short_summary=match.short_summary.strip() if match.short_summary else None,
            relevant_excerpt=match.relevant_excerpt.strip(),
            source_transcript=source_transcript.strip(),
            reason=match.reason,
            text_edit=match.text_edit,
            tools=list(dict.fromkeys(tools)),
            expected_content_version=match.expected_content_version,
        )
        async with self._queue_lock:
            # The browser retries until the contribution appears in shared
            # context. Do not enqueue the same edit twice while it is running.
            if job.text_edit:
                for existing in self._jobs.values():
                    if existing.idea_id == job.idea_id and existing.chunk_id == job.chunk_id and existing.status != "failed":
                        return existing.model_copy(deep=True)
            self._jobs[job.job_id] = job
        return job.model_copy(deep=True)

    async def get(self, job_id: str) -> Optional[EnrichmentJob]:
        async with self._queue_lock:
            job = self._jobs.get(job_id)
            return job.model_copy(deep=True) if job else None

    async def list(self, status: Optional[str] = None) -> List[EnrichmentJob]:
        async with self._queue_lock:
            jobs = list(self._jobs.values())
            if status:
                jobs = [job for job in jobs if job.status == status]
            return [job.model_copy(deep=True) for job in jobs]

    async def process_jobs(self, job_ids: Optional[Iterable[str]] = None) -> List[EnrichmentJob]:
        """Process FIFO groups in parallel, one sequential worker per idea."""
        selected_ids = set(job_ids) if job_ids is not None else None
        async with self._queue_lock:
            queued = [
                job
                for job in self._jobs.values()
                if job.status == "queued"
                and (selected_ids is None or job.job_id in selected_ids)
            ]

        groups: Dict[str, List[str]] = defaultdict(list)
        for job in queued:
            groups[job.idea_id].append(job.job_id)

        async def process_group(ids: List[str]):
            for queued_job_id in ids:
                await self.process_one(queued_job_id)

        await asyncio.gather(*(process_group(ids) for ids in groups.values()))
        return [job for job_id in [job.job_id for job in queued] if (job := await self.get(job_id))]

    async def process_one(self, job_id: str) -> EnrichmentJob:
        async with self._queue_lock:
            job = self._jobs.get(job_id)
            if not job:
                raise ValueError(f"Job '{job_id}' not found.")
            if job.status != "queued":
                return job.model_copy(deep=True)
            job.status = "running"
            job.started_at = time.time()

        async with self._idea_lock(job.idea_id):
            try:
                result = await self._apply_and_enrich(job)
                async with self._queue_lock:
                    job.result = result
                    job.status = result.get("status", "completed")
                    if job.status not in {"completed", "skipped"}:
                        job.status = "completed"
                    job.completed_at = time.time()
                    job.error = None
            except Exception as exc:
                async with self._queue_lock:
                    job.status = "failed"
                    job.completed_at = time.time()
                    job.error = f"{type(exc).__name__}: {str(exc)[:500]}"
        return (await self.get(job_id))  # type: ignore[return-value]

    async def _apply_and_enrich(self, job: EnrichmentJob) -> Dict[str, object]:
        idea = await storage.get_idea(job.idea_id)
        actually_new = idea is None
        if actually_new:
            if not job.is_new:
                raise ValueError(
                    f"Idea '{job.idea_id}' does not exist; mark the routed match as is_new=true."
                )
            if not job.title:
                raise ValueError("A title is required for a new idea.")
            idea = Idea(
                session_id=job.session_id,
                id=job.idea_id,
                title=job.title,
                short_summary=job.short_summary,
            )
        elif job.is_new:
            # Router retries are safe: an already-created idea becomes an update.
            actually_new = False
        if idea.session_id != job.session_id:
            raise ValueError("The idea belongs to another storm.")
        if job.title:
            idea.title = job.title
        if job.short_summary:
            idea.short_summary = job.short_summary

        if (
            job.expected_content_version is not None
            and idea.content_version != job.expected_content_version
        ):
            raise ValueError(
                f"Stale idea version: expected {job.expected_content_version}, "
                f"found {idea.content_version}."
            )

        if any(segment.chunk_id == job.chunk_id for segment in idea.transcript_segments):
            return {
                "status": "skipped",
                "idea_id": idea.id,
                "reason": "chunk_already_applied",
                "content_version": idea.content_version,
            }

        excerpt = job.relevant_excerpt.strip()
        if job.text_edit:
            if job.text_edit.title is not None:
                idea.title = job.text_edit.title
            if job.text_edit.summary is not None:
                idea.summary = job.text_edit.summary
        idea.transcript_segments.append(
            TranscriptSegment(
                chunk_id=job.chunk_id,
                text=excerpt,
                reason=job.reason,
            )
        )
        idea.raw_body = "\n\n".join(filter(None, [idea.raw_body.strip(), excerpt]))
        idea.transcript = idea.raw_body
        idea.content_version += 1
        input_version = idea.content_version
        idea.status = "idle"
        idea.updated_at = time.time()
        await storage.save_or_update_idea(idea)

        execution: Dict[str, object] = {}
        ordered_tools = [
            tool
            for tool in ["summary", "pros_cons", "workflow", "architecture", "competitors"]
            if tool in job.tools
        ]
        complete_pipeline = {
            "summary", "pros_cons", "workflow", "architecture", "competitors"
        }
        if set(ordered_tools) == complete_pipeline:
            pipeline = await orchestrator.enrich_idea_from_transcript(idea.id)
            execution = {
                tool: detail.get("status", "unknown")
                for tool, detail in pipeline.get("execution", {}).items()
            }
        else:
            for tool in ordered_tools:
                stage = await orchestrator.enrich_one(idea.id, tool)
                execution[tool] = stage["status"]

        current = await storage.get_idea(idea.id)
        if not current:
            raise RuntimeError(f"Idea '{idea.id}' disappeared during enrichment.")
        if current.content_version != input_version:
            raise RuntimeError(
                f"Idea '{idea.id}' changed while version {input_version} was being enriched."
            )

        artifact_versions = dict(current.metadata.get("artifact_versions", {}))
        for tool in ordered_tools:
            artifact_versions[tool] = input_version
        current.metadata["artifact_versions"] = artifact_versions
        if {"summary", "pros_cons"}.issubset(set(ordered_tools)):
            current.enriched_version = input_version
        current.updated_at = time.time()
        await storage.save_or_update_idea(current)

        return {
            "status": "completed",
            "idea_id": current.id,
            "is_new": actually_new,
            "content_version": current.content_version,
            "enriched_version": current.enriched_version,
            "tools": ordered_tools,
            "execution": execution,
        }


job_queue = EnrichmentJobQueue()
