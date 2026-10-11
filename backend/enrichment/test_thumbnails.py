import asyncio
import importlib
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from backend.enrichment.main import app, lifespan
from backend.enrichment.models import Idea
from backend.enrichment.storage import StorageManager
from backend.enrichment.thumbnail import (
    ThumbnailAgent, art_direction_for, generation_palette_for, palette_for, source_hash, validate_svg,
)
from backend.enrichment.thumbnail_worker import ThumbnailWorker

main_module = importlib.import_module("backend.enrichment.main")
thumbnail_module = importlib.import_module("backend.enrichment.thumbnail")


def artwork(idea):
    direction = art_direction_for(idea)
    primary, accent = direction["foreground"], direction["accent"]
    if direction["color_mode"] == "two-tone":
        accent = primary
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
<rect width="800" height="400" fill="{direction['background']}"/>
<path d="M0 400V255Q100 150 200 255T400 255T600 255T800 255V400Z" fill="{primary}"/>
<rect x="250" y="145" width="220" height="50" rx="25" fill="{primary}"/>
<path d="M120 185Q240 75 360 115" fill="none" stroke="{accent}" stroke-width="5" stroke-dasharray="9 11" stroke-linecap="round"/>
<circle cx="360" cy="115" r="24" fill="{accent}"/>
</svg>'''


class SvgValidationTest(unittest.TestCase):
    def test_rejects_excess_shapes_and_ornate_single_paths(self):
        idea = Idea(id="gaming", title="Gaming")
        base = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect width="800" height="400" fill="{palette_for(idea)[0]}"/>'
        for body in (
            '<circle cx="100" cy="100" r="20" fill="#000000"/>' * 6,
            '<path d="M0 0 ' + 'Q10 20 30 40 ' * 13 + 'Z" fill="#000000"/>',
            '<path d="M0 0 C' + '10 20 30 40 50 60 ' * 9 + 'Z" fill="#000000"/>',
            '<path d="M0 0L10 10Z M20 20L40 40Z" fill="#000000"/>',
            '<polygon points="' + '10,20 ' * 9 + '" fill="#000000"/>',
        ):
            with self.subTest(body=body), self.assertRaises(ValueError):
                validate_svg(base + body + '</svg>', palette_for(idea))

    def test_single_brand_color_is_enforced_and_accents_are_occasional(self):
        ideas = [Idea(id=f"idea-{index}", title="Topic") for index in range(100)]
        sizes = [len(generation_palette_for(idea)) for idea in ideas]
        self.assertGreater(sizes.count(1), sizes.count(2))
        self.assertGreater(sizes.count(2), 0)
        idea = Idea(id="gaming", title="Gaming")
        self.assertEqual(len(generation_palette_for(idea)), 1)
        svg = artwork(idea)
        validate_svg(svg, generation_palette_for(idea))
        with self.assertRaises(ValueError):
            validate_svg(svg.replace('</svg>', f'<circle r="4" fill="{art_direction_for(idea)["accent"]}"/></svg>'), generation_palette_for(idea))

    def test_accepts_two_tone_patterns_bright_backgrounds_and_cropped_geometry(self):
        palette = ("#ff7146", "#9ff6ee")
        for background in ("#000000", *palette):
            ink = palette[0] if background == "#000000" else "#000000"
            svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
<rect width="800" height="400" fill="{background}"/>
<path d="M-80 450V280Q60-120 200 260T520 210T900 290V450Z" fill="{ink}"/>
</svg>'''
            with self.subTest(background=background):
                self.assertIn('M-80 450', validate_svg(svg, palette, background))
                with self.assertRaises(ValueError):
                    validate_svg(svg, palette, ink)

    def test_art_directions_mix_styles_backgrounds_and_crops_stably(self):
        ideas = [Idea(id=f"idea-{index}", title="The same topic") for index in range(100)]
        directions = [art_direction_for(idea) for idea in ideas]
        self.assertEqual(len({direction["style"] for direction in directions}), 4)
        self.assertEqual(len({direction["composition"] for direction in directions}), 4)
        self.assertTrue(any(direction["background"] == "#000000" for direction in directions))
        self.assertTrue(any(direction["background"] != "#000000" for direction in directions))
        for idea, direction in zip(ideas, directions):
            self.assertEqual(direction, art_direction_for(idea.model_copy(update={"summary": "Changed"})))
            self.assertEqual({direction["background"], direction["foreground"], direction["accent"]}, {"#000000", *palette_for(idea)})

    def test_reference_composition_is_valid_and_palette_is_stable(self):
        idea = Idea(id="gaming", title="Autonomous gaming agent")
        result = validate_svg(artwork(idea), palette_for(idea))
        self.assertIn('width="800" height="400"', result)
        self.assertEqual(len(set(palette_for(idea))), 2)
        self.assertEqual(palette_for(idea), palette_for(idea.model_copy()))

    def test_rejects_active_content_extra_colors_and_complex_artwork(self):
        idea = Idea(id="gaming", title="Gaming")
        valid = artwork(idea)
        bad_values = [
            valid.replace("</svg>", "<script>alert(1)</script></svg>"),
            valid.replace("</svg>", '<image href="https://example.com/pixel"/></svg>'),
            valid.replace('<circle ', '<circle onload="alert(1)" '),
            valid.replace('<circle ', '<circle style="fill:red" '),
            valid.replace('<circle ', '<circle opacity="0.5" '),
            valid.replace(art_direction_for(idea)["background"], "#ffffff"),
            valid.replace("</svg>", "<text>Gaming</text></svg>"),
            valid.replace("</svg>", '<circle r="2"/>' * 30 + "</svg>"),
            valid.replace('width="800"', 'width="700"'),
            '<!DOCTYPE svg [<!ENTITY x "anything">]>' + valid,
            "<svg>", None,
        ]
        for value in bad_values:
            with self.subTest(value=str(value)[:100]), self.assertRaises(ValueError):
                validate_svg(value, palette_for(idea))


class ThumbnailWorkerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.store = StorageManager(root / "ideas.json", root / "transcript.txt")
        self.idea = await self.store.save_or_update_idea(Idea(
            id="gaming", title="Autonomous gaming agent", summary="Private summary context",
        ))
        self.agent = type("Agent", (), {"enabled": True})()
        self.agent.generate = AsyncMock(side_effect=lambda idea: artwork(idea))
        self.worker = ThumbnailWorker(self.store, self.agent)

    async def test_generates_once_preserves_artifacts_and_refreshes_url(self):
        old_url = self.idea.thumbnail
        self.assertEqual(await self.worker.process_pending(), 1)
        saved = await self.store.get_idea(self.idea.id)
        self.assertNotEqual(saved.thumbnail, old_url)
        self.assertIn("?v=", saved.thumbnail)
        expected = (self.store.artifacts.folder_for(saved.id) / "thumbnail.svg").read_text()
        saved.summary = "An updated summary should not change the illustration."
        await self.store.save_or_update_idea(saved)
        await self.store.materialize_all()
        with patch.object(main_module, "storage", self.store):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get(saved.thumbnail)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.text, expected)
                self.assertIn("image/svg+xml", response.headers["content-type"])
                self.assertEqual((await client.get("/ideas")).json()[0]["thumbnail"], saved.thumbnail)
        self.assertEqual(await self.worker.process_pending(), 0)
        self.agent.generate.assert_awaited_once()
        self.assertEqual((self.store.artifacts.folder_for(saved.id) / "thumbnail.svg").read_text(), expected)
        renamed = await self.store.get_idea(saved.id)
        renamed.title = "AI cake shop"
        await self.store.save_or_update_idea(renamed)
        self.assertEqual(await self.worker.process_pending(), 1)
        self.assertEqual(self.agent.generate.await_count, 2)

    async def test_title_only_model_prompt_and_validation(self):
        response = AsyncMock(return_value={"svg": artwork(self.idea)})
        with patch.object(thumbnail_module.llm_client, "generate_json", response):
            svg = await ThumbnailAgent().generate(self.idea)
        self.assertIn("Autonomous gaming agent", response.call_args.kwargs["prompt"])
        self.assertNotIn(self.idea.summary, response.call_args.kwargs["prompt"])
        self.assertIn('width="800"', svg)

    async def test_prompt_refinement_preserves_existing_v2_artwork(self):
        await self.worker.process_pending()
        metadata = self.store.artifacts.thumbnail_metadata(self.idea.id)
        metadata.pop("style_revision")
        self.store.artifacts._write_json(self.store.artifacts.folder_for(self.idea.id) / "thumbnail.json", metadata)
        self.assertEqual(await self.worker.process_pending(), 0)
        self.agent.generate.assert_awaited_once()

    async def test_style_revision_regenerates_v1_and_persists_art_direction(self):
        with patch.object(thumbnail_module, "GENERATOR", "title-svg-v1"):
            old_source = source_hash(self.idea)
        self.assertNotEqual(old_source, source_hash(self.idea))
        path = self.store.artifacts.folder_for(self.idea.id) / "thumbnail.json"
        self.store.artifacts._write_json(path, {
            "generator": "title-svg-v1", "source_hash": old_source,
            "generation": {"source_hash": old_source, "status": "ready", "attempts": 1},
        })
        self.assertEqual(await self.worker.process_pending(), 1)
        metadata = self.store.artifacts.thumbnail_metadata(self.idea.id)
        self.assertEqual(metadata["generator"], "title-svg-v2")
        self.assertEqual(metadata["art_direction"], art_direction_for(self.idea))
        self.assertEqual(await self.worker.process_pending(), 0)

    async def test_generation_does_not_block_saves_or_overwrite_new_summary(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def generate(idea):
            started.set()
            await release.wait()
            return artwork(idea)

        self.agent.generate.side_effect = generate
        task = asyncio.create_task(self.worker.process_pending())
        await asyncio.wait_for(started.wait(), 1)
        current = await self.store.get_idea(self.idea.id)
        current.summary = "A concurrently enriched summary"
        current.content_version = 8
        await asyncio.wait_for(self.store.save_or_update_idea(current), 1)
        release.set()
        await task
        saved = await self.store.get_idea(current.id)
        self.assertEqual(saved.summary, current.summary)
        self.assertEqual(saved.content_version, 8)
        self.assertIn("?v=", saved.thumbnail)

    async def test_discards_result_for_renamed_idea(self):
        async def generate(idea):
            current = await self.store.get_idea(idea.id)
            current.title = "A completely different idea"
            await self.store.save_or_update_idea(current)
            return artwork(idea)

        self.agent.generate.side_effect = generate
        await self.worker.process_pending()
        saved = await self.store.get_idea(self.idea.id)
        self.assertNotIn("?v=", saved.thumbnail)
        self.assertTrue(self.worker.needs_generation(saved, time.time()))

    async def test_deleted_idea_is_not_resurrected(self):
        async def generate(idea):
            self.store.ideas_path.write_text('{"ideas": []}')
            return artwork(idea)

        self.agent.generate.side_effect = generate
        await self.worker.process_pending()
        self.assertIsNone(await self.store.get_idea(self.idea.id))

    async def test_failure_retries_persist_and_keep_previous_artwork(self):
        await self.worker.process_pending()
        saved = await self.store.get_idea(self.idea.id)
        old_url = saved.thumbnail
        saved.title = "A revised gaming concept"
        await self.store.save_or_update_idea(saved)
        self.agent.generate.side_effect = ValueError("invalid SVG")
        for attempt in range(1, 4):
            self.assertEqual(await self.worker.process_pending(), 1)
            state = self.store.artifacts.thumbnail_metadata(saved.id)["generation"]
            self.assertEqual(state["status"], "failed")
            self.assertEqual(state["attempts"], attempt)
            self.assertEqual((await self.store.get_idea(saved.id)).thumbnail, old_url)
            self.assertEqual(await self.worker.process_pending(), 0)
            await self.store.update_thumbnail(saved.id, source_hash(saved), {**state, "next_retry_at": 0})
            self.worker = ThumbnailWorker(self.store, self.agent)  # restart
        self.assertEqual(await self.worker.process_pending(), 0)

    async def test_recovers_expired_running_job_and_skips_without_credentials(self):
        await self.store.update_thumbnail(self.idea.id, source_hash(self.idea), {
            "source_hash": source_hash(self.idea), "status": "generating",
            "attempts": 1, "next_retry_at": 0,
        })
        self.agent.enabled = False
        self.assertEqual(await self.worker.process_pending(), 0)
        self.agent.enabled = True
        self.assertEqual(await self.worker.process_pending(), 1)

    async def test_missing_generated_file_is_rebuilt(self):
        await self.worker.process_pending()
        path = self.store.artifacts.folder_for(self.idea.id) / "thumbnail.svg"
        path.unlink()
        self.assertEqual(await self.worker.process_pending(), 1)
        self.assertTrue(path.is_file())

    async def test_timeout_keeps_placeholder_and_schedules_retry(self):
        async def generate(_idea):
            await asyncio.Event().wait()

        self.agent.generate.side_effect = generate
        with patch("backend.enrichment.thumbnail_worker.THUMBNAIL_TIMEOUT_SECONDS", 0.01):
            await self.worker.process_pending()
        state = self.store.artifacts.thumbnail_metadata(self.idea.id)["generation"]
        self.assertEqual(state["status"], "failed")
        self.assertEqual(state["error"], "TimeoutError")
        self.assertGreater(state["next_retry_at"], time.time())
        self.assertEqual((await self.store.get_idea(self.idea.id)).thumbnail, self.idea.thumbnail)

    async def test_api_lifespan_starts_and_stops_worker(self):
        started, cancelled = asyncio.Event(), asyncio.Event()

        async def run(_worker):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        with patch.object(main_module, "THUMBNAILS_ENABLED", True), patch.object(ThumbnailWorker, "run", run):
            async with lifespan(app):
                await asyncio.wait_for(started.wait(), 1)
        self.assertTrue(cancelled.is_set())


if __name__ == "__main__":
    unittest.main()
