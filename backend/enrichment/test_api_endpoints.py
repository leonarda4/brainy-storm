import asyncio
import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from backend.enrichment.job_queue import EnrichmentJobQueue
from backend.enrichment.llm_client import llm_client
from backend.enrichment.main import app
from backend.enrichment.orchestrator import AgenticOrchestrator
from backend.enrichment.storage import StorageManager


main_module = importlib.import_module("backend.enrichment.main")
orchestrator_module = importlib.import_module("backend.enrichment.orchestrator")
job_queue_module = importlib.import_module("backend.enrichment.job_queue")
llm_client_module = importlib.import_module("backend.enrichment.llm_client")


class EnrichmentApiEndpointTest(unittest.IsolatedAsyncioTestCase):
    async def test_all_rest_endpoints(self):
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

            patches = (
                patch.object(main_module, "storage", test_storage),
                patch.object(main_module, "orchestrator", test_orchestrator),
                patch.object(main_module, "job_queue", test_queue),
                patch.object(orchestrator_module, "storage", test_storage),
                patch.object(job_queue_module, "storage", test_storage),
                patch.object(job_queue_module, "orchestrator", test_orchestrator),
                patch.object(llm_client, "gemini_key", ""),
                patch.object(llm_client, "openai_key", ""),
                patch.object(llm_client_module, "DEFAULT_PROVIDER", "mock"),
                patch.object(llm_client, "search_web", no_search),
            )

            for active_patch in patches:
                active_patch.start()
            self.addCleanup(lambda: [active_patch.stop() for active_patch in reversed(patches)])

            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                expected_paths = {
                    "/health",
                    "/models/ping",
                    "/ideas",
                    "/ideas/{identifier}",
                    "/ideas/{identifier}/artifacts",
                    "/ideas/{identifier}/artifacts/{filename}",
                    "/ideas/{identifier}/ingest",
                    "/ideas/{identifier}/enrich",
                    "/ideas/{identifier}/enrich/{service}",
                    "/transcript/chunks",
                    "/transcript/classified-chunks",
                    "/enrichment/queue/jobs",
                    "/enrichment/queue/jobs/{job_id}",
                    "/enrichment/queue/jobs/{job_id}/run",
                    "/enrichment/queue/drain",
                    "/enrich/auto",
                    "/enrich/manual",
                    "/ws",
                }
                registered_paths = {route.path for route in app.routes}
                self.assertTrue(expected_paths.issubset(registered_paths))

                response = await client.get("/health")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["api_revision"], "idea-artifacts-v4")

                response = await client.get("/models/ping", params={"provider": "invalid"})
                self.assertEqual(response.status_code, 400)
                with patch.object(
                    llm_client,
                    "ping_models",
                    AsyncMock(return_value={
                        "ok": True,
                        "providers": {"gemini": {"status": "ok"}},
                    }),
                ):
                    response = await client.get(
                        "/models/ping", params={"provider": "gemini"}
                    )
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["ok"])

                response = await client.get("/ideas")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), [])

                response = await client.get("/ideas/missing")
                self.assertEqual(response.status_code, 404)

                response = await client.post(
                    "/ideas",
                    json={
                        "id": "api-idea",
                        "title": "API idea",
                        "transcript": "Maya: Build a queue-backed idea enrichment API.",
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(
                    response.json()["thumbnail"],
                    "/ideas/api-idea/artifacts/thumbnail.svg",
                )

                response = await client.get("/ideas/api-idea")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["id"], "api-idea")

                for service in ("summary", "pros-cons", "workflow", "architecture", "competitors"):
                    response = await client.post(
                        f"/ideas/api-idea/enrich/{service}", json={}
                    )
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()["status"], "success")

                response = await client.post("/ideas/api-idea/enrich", json={})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["status"], "enriched")

                response = await client.get("/ideas/api-idea/artifacts")
                self.assertEqual(response.status_code, 200, response.text)
                artifact_names = {item["name"] for item in response.json()["files"]}
                self.assertTrue({
                    "idea.json", "summary.md", "pros-cons.md", "competitors.md",
                    "workflow.svg", "system-architecture.svg", "thumbnail.svg",
                    "thumbnail.json", "manifest.json",
                }.issubset(artifact_names))
                response = await client.get("/ideas/api-idea/artifacts/pros-cons.md")
                self.assertEqual(response.status_code, 200)
                self.assertIn("Pros Voiced in Discussion", response.text)

                response = await client.post(
                    "/ideas/api-idea/ingest",
                    json={
                        "transcript": "Lee: Add retries and a dead-letter queue.",
                        "enrich": False,
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["status"], "ingested")

                response = await client.post(
                    "/transcript/chunks",
                    json={
                        "chunk_id": "queue-chunk-1",
                        "transcript": "Maya introduces a repair kiosk.",
                        "matches": [{
                            "idea_id": "queued-idea",
                            "is_new": True,
                            "title": "Queued repair kiosk",
                            "relevant_excerpt": "Maya: Build a repair kiosk.",
                        }],
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                queued_job = response.json()["jobs"][0]
                self.assertEqual(queued_job["status"], "queued")
                job_id = queued_job["job_id"]

                response = await client.get("/enrichment/queue/jobs", params={"status": "queued"})
                self.assertEqual(response.status_code, 200)
                self.assertGreaterEqual(response.json()["count"], 1)

                response = await client.get(f"/enrichment/queue/jobs/{job_id}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["job_id"], job_id)

                response = await client.post(f"/enrichment/queue/jobs/{job_id}/run")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["status"], "completed")
                self.assertEqual(
                    response.json()["result"]["tools"],
                    ["summary", "pros_cons", "workflow", "architecture", "competitors"],
                )

                response = await client.post(
                    "/transcript/classified-chunks",
                    json={
                        "chunks": [{
                            "chunk": "Nina: Build a voice-controlled planning board.",
                            "ideas": [{
                                "id": "classified-idea",
                                "title": "Voice planning board",
                                "short-summary": "Initial screening only",
                            }],
                            "has_been_processsed": False,
                        }],
                        "process_now": True,
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["status"], "processed")
                self.assertTrue(response.json()["chunks"][0]["has_been_processed"])
                classified_idea = await test_storage.get_idea("classified-idea")
                self.assertEqual(classified_idea.short_summary, "Initial screening only")
                self.assertTrue((root / "ideas" / "classified-idea.json").is_file())

                response = await client.post(
                    "/transcript/chunks",
                    json={
                        "chunk_id": "queue-chunk-2",
                        "transcript": "Lee identifies a risk.",
                        "matches": [{
                            "idea_id": "queued-idea",
                            "relevant_excerpt": "Lee: Theft is a key risk.",
                        }],
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)

                response = await client.post("/enrichment/queue/drain")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["status"], "completed")
                self.assertEqual(
                    response.json()["jobs"][0]["result"]["tools"],
                    ["summary", "pros_cons"],
                )

                response = await client.post(
                    "/transcript/chunks",
                    json={
                        "chunk_id": "queue-chunk-2",
                        "transcript": "Duplicate delivery.",
                        "matches": [{
                            "idea_id": "queued-idea",
                            "relevant_excerpt": "Lee: Theft is a key risk.",
                        }],
                        "process_now": True,
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["jobs"][0]["status"], "skipped")

                response = await client.post(
                    "/enrich/auto",
                    json={
                        "idea_id": "api-idea",
                        "context": "The queue needs retries and monitoring.",
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertTrue(response.json()["triggered"])

                response = await client.post(
                    "/enrich/manual",
                    json={"idea_id": "api-idea", "service": "pros_cons"},
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["status"], "enriching")

                # Allow both legacy background dispatches to finish before the
                # temporary storage directory is removed.
                for _ in range(100):
                    idea = await test_storage.get_idea("api-idea")
                    if idea and idea.status != "enriching":
                        break
                    await asyncio.sleep(0.01)

                response = await client.post(
                    "/ideas/api-idea/enrich/not-a-service", json={}
                )
                self.assertEqual(response.status_code, 400)

                response = await client.get("/enrichment/queue/jobs/not-found")
                self.assertEqual(response.status_code, 404)

                response = await client.post(
                    "/transcript/chunks",
                    json={
                        "chunk_id": "queue-chunk-3",
                        "transcript": "Maya proposes night lighting.",
                        "matches": [{
                            "idea_id": "queued-idea",
                            "relevant_excerpt": "Maya: Add night lighting.",
                        }],
                    },
                )
                background_job_id = response.json()["jobs"][0]["job_id"]
                response = await client.post("/enrichment/queue/drain", params={"wait": False})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["status"], "dispatched")
                for _ in range(100):
                    response = await client.get(
                        f"/enrichment/queue/jobs/{background_job_id}"
                    )
                    if response.json()["status"] in {"completed", "failed"}:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual(response.json()["status"], "completed", response.text)

                response = await client.post("/enrichment/queue/drain", params={"wait": False})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["status"], "empty")

                queued_idea = await test_storage.get_idea("queued-idea")
                self.assertEqual(queued_idea.content_version, 3)
                self.assertEqual(queued_idea.enriched_version, 3)
                self.assertEqual(len(queued_idea.transcript_segments), 3)


class EnrichmentWebSocketEndpointTest(unittest.TestCase):
    def test_websocket_accepts_client_messages(self):
        with patch.object(main_module, "THUMBNAILS_ENABLED", False), TestClient(app) as client:
            with client.websocket_connect("/ws") as websocket:
                websocket.send_text("ping")


if __name__ == "__main__":
    unittest.main()
