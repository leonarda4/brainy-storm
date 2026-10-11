import asyncio
import importlib
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx

from backend.enrichment.job_queue import EnrichmentJobQueue
from backend.enrichment.main import app
from backend.enrichment.models import Idea, RoutedIdeaMatch
from backend.enrichment.storage import StorageManager

main_module = importlib.import_module("backend.enrichment.main")
queue_module = importlib.import_module("backend.enrichment.job_queue")


class TextEditsTest(unittest.IsolatedAsyncioTestCase):
    async def test_written_input_is_serialized_with_speech_and_retries_are_idempotent(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as patches:
            root = Path(directory)
            store = StorageManager(root / "ideas.json", root / "transcript.txt")
            await store.save_or_update_idea(Idea(
                id="idea-1", title="Original", raw_body="Alex: An initial spoken idea."
            ))
            queue = EnrichmentJobQueue()
            contexts = []
            started = asyncio.Event()
            release = asyncio.Event()

            class Pipeline:
                async def enrich_idea_from_transcript(self, identifier):
                    idea = await store.get_idea(identifier)
                    contexts.append((idea.raw_body, idea.title, idea.summary))
                    if len(contexts) == 1:
                        started.set()
                        await release.wait()
                    idea.summary = "Live summary including written details"
                    idea.status = "enriched"
                    await store.save_or_update_idea(idea)
                    return {"execution": {tool: {"status": "success"} for tool in (
                        "summary", "pros_cons", "workflow", "architecture", "competitors"
                    )}}

            for module, name, replacement in [
                (main_module, "storage", store),
                (main_module, "job_queue", queue),
                (queue_module, "storage", store),
                (queue_module, "orchestrator", Pipeline()),
            ]:
                patches.enter_context(patch.object(module, name, replacement))

            speech = await queue.enqueue("speech-1", "Alex: More spoken context.", RoutedIdeaMatch(
                idea_id="idea-1", relevant_excerpt="Alex: More spoken context.",
                tools=["summary", "pros_cons", "workflow", "architecture", "competitors"],
            ))
            speech_task = asyncio.create_task(queue.process_one(speech.job_id))
            await started.wait()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                payload = {"edit_id": "edit-1", "title": "Written title", "summary": "Also works offline; not discussed aloud."}
                first = await client.post("/ideas/idea-1/text-edits", json=payload)
                second = await client.post("/ideas/idea-1/text-edits", json=payload)
                self.assertEqual(first.status_code, 202)
                self.assertEqual(first.json()["job_id"], second.json()["job_id"])
                release.set()
                await speech_task
                await asyncio.gather(*list(main_module.background_queue_tasks))
                saved = await store.get_idea("idea-1")
                self.assertIn("More spoken context", saved.raw_body)
                self.assertIn("not discussed aloud", saved.raw_body)
                self.assertIn("User written contribution (not spoken", saved.raw_body)
                self.assertEqual(saved.raw_body.count("not discussed aloud"), 1)
                self.assertEqual(saved.content_version, 2)
                self.assertEqual(saved.enriched_version, 2)
                self.assertEqual(saved.transcript_segments[-1].chunk_id, "text-edit:edit-1")
                self.assertEqual(saved.summary, "Live summary including written details")
                self.assertEqual(contexts[-1][1:], (payload["title"], payload["summary"]))
                self.assertEqual(set(saved.metadata["artifact_versions"]), {
                    "summary", "pros_cons", "workflow", "architecture", "competitors"
                })

                # Deduplication also survives the in-memory queue being restarted.
                patches.enter_context(patch.object(main_module, "job_queue", EnrichmentJobQueue()))
                await client.post("/ideas/idea-1/text-edits", json=payload)
                await asyncio.gather(*list(main_module.background_queue_tasks))
                self.assertEqual((await store.get_idea("idea-1")).content_version, 2)
                self.assertEqual(len(contexts), 2)

                invalid = await client.post("/ideas/idea-1/text-edits", json={"edit_id": "empty"})
                self.assertEqual(invalid.status_code, 422)

    async def test_new_written_idea_is_created_and_empty_fields_are_valid_edits(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as patches:
            root = Path(directory)
            store = StorageManager(root / "ideas.json", root / "transcript.txt")
            queue = EnrichmentJobQueue()

            class Pipeline:
                async def enrich_idea_from_transcript(self, identifier):
                    return {"execution": {}}

            for module, name, replacement in [
                (main_module, "job_queue", queue), (queue_module, "storage", store),
                (queue_module, "orchestrator", Pipeline()),
            ]:
                patches.enter_context(patch.object(module, name, replacement))
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/ideas/new-written/text-edits", json={
                    "edit_id": "new-1", "is_new": True, "idea_title": "New written idea", "summary": ""
                })
                self.assertEqual(response.status_code, 202)
                await asyncio.gather(*list(main_module.background_queue_tasks))
                saved = await store.get_idea("new-written")
                self.assertEqual(saved.title, "New written idea")
                self.assertEqual(saved.summary, "")
                self.assertEqual(saved.content_version, 1)


if __name__ == "__main__":
    unittest.main()
