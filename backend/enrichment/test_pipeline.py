import tempfile
import unittest
import importlib
from pathlib import Path
from unittest.mock import patch

from backend.enrichment.llm_client import llm_client
from backend.enrichment.job_queue import EnrichmentJobQueue
from backend.enrichment.models import Idea, RoutedIdeaMatch
from backend.enrichment.orchestrator import AgenticOrchestrator
from backend.enrichment.storage import StorageManager

orchestrator_module = importlib.import_module("backend.enrichment.orchestrator")
llm_client_module = importlib.import_module("backend.enrichment.llm_client")
job_queue_module = importlib.import_module("backend.enrichment.job_queue")


class SelectedIdeaPipelineTest(unittest.IsolatedAsyncioTestCase):
    async def test_selected_idea_is_enriched_from_its_transcript(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            test_storage = StorageManager(
                ideas_path=root / "ideas.json",
                transcript_path=root / "transcript.txt",
            )
            await test_storage.save_or_update_idea(Idea(
                id="solar-kiosk",
                title="Solar repair kiosk",
                transcript=(
                    "Maya: Commuters need quick phone repairs. "
                    "Jon: Solar power lowers operating costs. "
                    "Lee: Weather and theft are serious risks."
                ),
            ))

            async def no_search(*_args, **_kwargs):
                return []

            with (
                patch.object(orchestrator_module, "storage", test_storage),
                patch.object(llm_client, "gemini_key", ""),
                patch.object(llm_client, "openai_key", ""),
                patch.object(llm_client_module, "DEFAULT_PROVIDER", "mock"),
                patch.object(llm_client, "search_web", no_search),
            ):
                test_orchestrator = AgenticOrchestrator()
                result = await test_orchestrator.enrich_idea_from_transcript("solar-kiosk")
                individual_results = [
                    await test_orchestrator.enrich_one("solar-kiosk", service)
                    for service in ("summary", "pros-cons", "workflow", "architecture", "competitors")
                ]
                ingest_result = await test_orchestrator.ingest_transcript_delta(
                    "solar-kiosk",
                    "Maya: Add battery storage so the kiosk can operate after sunset.",
                    enrich=False,
                )
                duplicate_result = await test_orchestrator.ingest_transcript_delta(
                    "solar-kiosk",
                    "Maya: Add battery storage so the kiosk can operate after sunset.",
                    enrich=False,
                )

            self.assertEqual(result["status"], "enriched")
            saved = await test_storage.get_idea("solar-kiosk")
            self.assertIsNotNone(saved)
            self.assertTrue(saved.summary)
            self.assertIsNotNone(saved.pros_cons)
            self.assertTrue(saved.workflow and saved.workflow.mermaid_code)
            self.assertTrue(saved.systemGraph and saved.systemGraph.mermaid_code)
            self.assertIsNotNone(saved.competitors)
            self.assertTrue(all(
                competitor.idea
                and competitor.yearOfFounding
                and competitor.shortBio
                and competitor.howWeDiffer
                for competitor in saved.competitors.competitors
            ))
            self.assertTrue(saved.transcript.startswith("Maya:"))
            self.assertIn("battery storage", saved.raw_body)
            self.assertTrue(all(item["status"] == "success" for item in individual_results))
            self.assertEqual(ingest_result["status"], "ingested")
            self.assertEqual(duplicate_result["status"], "duplicate")

    async def test_routed_chunks_are_queued_versioned_and_deduplicated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            test_storage = StorageManager(
                ideas_path=root / "ideas.json",
                transcript_path=root / "transcript.txt",
            )
            test_orchestrator = AgenticOrchestrator()
            test_queue = EnrichmentJobQueue()

            async def no_search(*_args, **_kwargs):
                return []

            with (
                patch.object(orchestrator_module, "storage", test_storage),
                patch.object(job_queue_module, "storage", test_storage),
                patch.object(job_queue_module, "orchestrator", test_orchestrator),
                patch.object(llm_client, "gemini_key", ""),
                patch.object(llm_client, "openai_key", ""),
                patch.object(llm_client_module, "DEFAULT_PROVIDER", "mock"),
                patch.object(llm_client, "search_web", no_search),
            ):
                first = await test_queue.enqueue(
                    chunk_id="chunk-1",
                    source_transcript="Maya proposes a solar repair kiosk.",
                    match=RoutedIdeaMatch(
                        idea_id="solar-queue",
                        is_new=True,
                        title="Solar repair kiosk",
                        relevant_excerpt="Maya: I propose a solar-powered repair kiosk.",
                    ),
                )
                first_result = await test_queue.process_one(first.job_id)

                duplicate = await test_queue.enqueue(
                    chunk_id="chunk-1",
                    source_transcript="Redelivered chunk.",
                    match=RoutedIdeaMatch(
                        idea_id="solar-queue",
                        relevant_excerpt="Maya: I propose a solar-powered repair kiosk.",
                    ),
                )
                duplicate_result = await test_queue.process_one(duplicate.job_id)

                update = await test_queue.enqueue(
                    chunk_id="chunk-2",
                    source_transcript="Lee raises a theft concern.",
                    match=RoutedIdeaMatch(
                        idea_id="solar-queue",
                        relevant_excerpt="Lee: Theft and overnight security are risks.",
                    ),
                )
                update_result = await test_queue.process_one(update.job_id)

            saved = await test_storage.get_idea("solar-queue")
            self.assertIsNotNone(saved)
            self.assertEqual(first_result.status, "completed")
            self.assertEqual(first_result.result["tools"], [
                "summary", "pros_cons", "workflow", "architecture", "competitors"
            ])
            self.assertEqual(duplicate_result.status, "skipped")
            self.assertEqual(update_result.status, "completed")
            self.assertEqual(update_result.result["tools"], ["summary", "pros_cons"])
            self.assertEqual(saved.content_version, 2)
            self.assertEqual(saved.enriched_version, 2)
            self.assertEqual(len(saved.transcript_segments), 2)
            self.assertIn("overnight security", saved.raw_body)


if __name__ == "__main__":
    unittest.main()
