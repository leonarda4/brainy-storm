"""Independent, bounded background work; existing ideas are also backfilled."""

import asyncio
import logging
import time

from .config import THUMBNAIL_TIMEOUT_SECONDS
from .storage import StorageManager
from .thumbnail import GENERATOR, ThumbnailAgent, source_hash

logger = logging.getLogger(__name__)


class ThumbnailWorker:
    def __init__(self, storage: StorageManager, agent=None):
        self.storage = storage
        self.agent = agent if agent is not None else ThumbnailAgent()

    def needs_generation(self, idea, now: float) -> bool:
        if not idea.title.strip():
            return False
        metadata = self.storage.artifacts.thumbnail_metadata(idea.id)
        current_source = source_hash(idea)
        if (
            metadata.get("generator") == GENERATOR
            and metadata.get("source_hash") == current_source
        ):
            return not (self.storage.artifacts.folder_for(idea.id) / "thumbnail.svg").is_file()
        state = metadata.get("generation", {})
        if state.get("source_hash") != current_source:
            return True
        # A running job's lease expires after a crash, so startup can recover it.
        return state.get("next_retry_at", 0) <= now and (
            state.get("attempts", 0) < 3 or state.get("status") == "generating"
        )

    async def process_pending(self) -> int:
        if not self.agent.enabled:
            return 0
        ideas = await self.storage.get_all_ideas()
        pending = [idea for idea in ideas if self.needs_generation(idea, time.time())][:2]
        results = await asyncio.gather(
            *(self._generate(idea) for idea in pending), return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception):
                logger.error("Thumbnail job failed (%s)", type(result).__name__)
        return len(pending)

    async def _generate(self, idea):
        expected_source = source_hash(idea)
        previous = self.storage.artifacts.thumbnail_metadata(idea.id).get("generation", {})
        attempts = previous.get("attempts", 0) if (
            previous.get("source_hash") == expected_source and previous.get("status") != "ready"
        ) else 0
        state = {
            "source_hash": expected_source,
            "status": "generating",
            "attempts": min(attempts + 1, 3),
            "next_retry_at": time.time() + THUMBNAIL_TIMEOUT_SECONDS + 30,
        }
        if not await self.storage.update_thumbnail(idea.id, expected_source, state):
            return
        try:
            result = await asyncio.wait_for(self.agent.generate(idea), THUMBNAIL_TIMEOUT_SECONDS)
            if isinstance(result, tuple):
                svg, recipe = result
            else:
                svg, recipe = result, None
            await self.storage.update_thumbnail(
                idea.id, expected_source, {**state, "status": "ready", "next_retry_at": 0},
                svg, recipe,
            )
        except asyncio.CancelledError:
            await self.storage.update_thumbnail(idea.id, expected_source, {
                **state, "status": "pending", "attempts": attempts, "next_retry_at": 0,
            })
            raise
        except Exception as exc:
            # Do not persist provider messages, which can contain request details.
            logger.warning("Thumbnail generation failed for %s (%s)", idea.id, type(exc).__name__)
            await self.storage.update_thumbnail(idea.id, expected_source, {
                **state, "status": "failed", "error": type(exc).__name__,
                "next_retry_at": time.time() + 30 * 2 ** (state["attempts"] - 1),
            })

    async def run(self):
        while True:
            try:
                await self.process_pending()
            except Exception:
                logger.exception("Thumbnail worker scan failed")
            await asyncio.sleep(3)
