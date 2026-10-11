import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException

import main
from speakers import SpeakerTracker
from storm import StormAgent, STORM_COMMENT


class FakeSTT:
    def __init__(self):
        self.messages = asyncio.Queue()
        self.audio_count = 0
        self.eos_count = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def send_audio(self, audio):
        self.audio_count += 1
        await self.messages.put({"type": "text", "text": "Hi, I'm Maya.", "start_s": 0})

    async def send_eos(self):
        self.eos_count += 1
        await self.messages.put({"type": "text", "text": "One last thought.", "start_s": 2})
        await self.messages.put({"type": "end_of_stream"})

    async def recv(self):
        return await self.messages.get()


class FakeSocket:
    def __init__(self, messages=None):
        self.messages = asyncio.Queue()
        for message in messages or [
            {"type": "websocket.receive", "bytes": b"\x01\x00" * 24000 * 5},
            {"type": "websocket.receive", "text": '{"action":"stop"}'},
        ]:
            self.messages.put_nowait(message)
        self.sent = []
        self.code = None

    async def accept(self):
        pass

    async def receive(self):
        await asyncio.sleep(0.01)
        return await self.messages.get()

    async def send_json(self, message):
        self.sent.append(message)

    async def close(self, code):
        self.code = code


class RecordingTests(unittest.IsolatedAsyncioTestCase):
    def test_saved_dated_voices_are_not_reused_after_a_restart(self):
        self.assertEqual(main.next_speaker_number("[Speaker 2] Old.\n[2026-10-11T12:00:00+00:00] [Speaker 8] New.\n"), 9)

    async def asyncSetUp(self):
        self.directory = TemporaryDirectory()
        self.file = Path(self.directory.name) / "transcript.txt"
        self.file.write_text("Older transcript.\n")
        self.patches = [patch.object(main, "TRANSCRIPT_FILE", self.file),
                        patch.object(main, "guard", asyncio.Lock()),
                        patch.object(main, "recording_active", False)]
        for item in self.patches:
            item.start()
        main.app.state.api_key = "test-key"
        self.tracker = SpeakerTracker("test-key", "test-model")
        main.app.state.speakers = self.tracker
        main.app.state.storm = StormAgent("", "test-model", enabled=False)
        self.stt = FakeSTT()
        client = SimpleNamespace(stt_realtime=Mock(return_value=self.stt))
        self.client_patch = patch.object(main.gradium, "GradiumClient", return_value=client)
        self.client_patch.start()

    async def asyncTearDown(self):
        self.client_patch.stop()
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    async def test_projects_record_resume_and_reset_independently(self):
        main.app.state.sessions = {}
        for project in ("project-a", "project-b"):
            self.assertEqual((await main.transcript(project))["transcript"], "")
            path = main.transcript_path(project)
            tracker, _ = main.session_agents(project, path)
            tracker.identify = AsyncMock(return_value=[{"person": "Maya", "text": f"Speech for {project}.", "timestamp": ""}])
            socket = FakeSocket()
            await main.transcribe(socket, project)
            self.assertEqual(socket.code, 1000)
            self.assertEqual((await main.transcript(project))["transcript"], f"[Maya] Speech for {project}.\n")
        await main.transcribe(FakeSocket(), "project-a")
        self.assertEqual((await main.transcript("project-a"))["transcript"].count("Speech for project-a."), 2)
        await main.reset("project-b")
        self.assertEqual((await main.transcript("project-b"))["transcript"], "")
        self.assertIn("Speech for project-a.", (await main.transcript("project-a"))["transcript"])
        self.assertEqual(self.file.read_text(), "Older transcript.\n")
        with self.assertRaises(HTTPException):
            await main.transcript("../outside")

    async def test_stop_drains_final_text_then_saves_named_transcript_and_releases_slot(self):
        async def identify(pcm, fragments):
            self.assertTrue(pcm)
            return [{"person": "Maya", "text": " ".join(f["text"] for f in fragments), "timestamp": fragments[0]["timestamp"]}]
        self.tracker.identify = identify
        socket = FakeSocket()
        await main.transcribe(socket)
        self.assertEqual(socket.code, 1000)
        self.assertEqual(self.stt.eos_count, 1)
        self.assertFalse(main.recording_active)
        pending = [m for m in socket.sent if m["type"] == "transcript"]
        attributed = [m for m in socket.sent if m["type"] == "speakers"]
        timestamp = pending[0]['timestamp']
        first = main.datetime.fromisoformat(timestamp)
        final = main.datetime.fromisoformat(pending[-1]['timestamp'])
        self.assertIsNotNone(first.tzinfo)
        self.assertEqual((final - first).total_seconds(), 2)
        self.assertEqual(self.file.read_text(), f"Older transcript.\n[{timestamp}] [Maya] Hi, I'm Maya. One last thought.\n")
        self.assertEqual(attributed[0]['lines'][0]['timestamp'], timestamp)
        self.assertEqual(attributed[0]["replace_ids"], [m["id"] for m in pending])
        self.assertEqual((await main.transcript())["transcript"], self.file.read_text())

    async def test_saved_transcript_available_without_provider_credentials(self):
        with patch.dict(main.os.environ, {"GRADIUM_API_KEY": "", "GEMINI_API_KEY": ""}):
            async with main.lifespan(main.app):
                self.assertEqual((await main.transcript())["transcript"], "Older transcript.\n")
                socket = FakeSocket()
                await main.transcribe(socket)
                self.assertEqual(socket.code, 1008)
                self.assertIn("GRADIUM_API_KEY", socket.sent[0]["message"])
                self.assertFalse(main.recording_active)
                self.assertEqual(self.stt.audio_count, 0)
                self.assertEqual(self.file.read_text(), "Older transcript.\n")

    async def test_casual_introduction_reaches_saved_transcript_live_captions_and_focus_agent(self):
        async def send_audio(audio):
            await self.stt.messages.put({"type": "text", "text": "Hi, it's Leonarda. So", "start_s": 0})
        self.stt.send_audio = send_audio

        async def identify(pcm, fragments):
            words = " ".join(fragment["text"] for fragment in fragments).split()
            return self.tracker.apply({"turns": [{
                "first_word": 0, "last_word": len(words) - 1, "voice": "new1",
                "name": "Leonarda", "introduction": "Hi, it's Leonarda",
                "start_s": 0, "end_s": 4,
            }]}, pcm, words, fragments[0]["timestamp"])
        self.tracker.identify = identify
        socket = FakeSocket()
        await main.transcribe(socket)
        expected = "Hi, it's Leonarda. So One last thought."
        self.assertEqual(socket.code, 1000)
        self.assertIn(f"[Leonarda] {expected}\n", self.file.read_text())
        self.assertIn(f"[Leonarda] {expected}", (await main.transcript())["transcript"])
        attributed = next(message for message in socket.sent if message["type"] == "speakers")
        self.assertEqual(attributed["lines"][0]["person"], "Leonarda")
        timestamp = attributed['lines'][0]['timestamp']
        self.assertEqual(list(main.app.state.storm.fragments)[0][1], f"[{timestamp}] [Leonarda] {expected}")

    async def test_starting_without_credentials_creates_an_empty_local_transcript(self):
        self.file.unlink()
        with patch.dict(main.os.environ, {"GRADIUM_API_KEY": "your-gradium-api-key-here", "GEMINI_API_KEY": ""}):
            async with main.lifespan(main.app):
                self.assertEqual((await main.transcript())["transcript"], "")
                self.assertFalse(main.app.state.api_key)

    async def test_speaker_service_failure_preserves_every_word_and_warns_without_aborting_capture(self):
        self.tracker.identify = AsyncMock(side_effect=RuntimeError("Speaker provider unavailable"))
        socket = FakeSocket()
        await main.transcribe(socket)
        self.assertEqual(socket.code, 1000)
        self.assertIn("[Unknown speaker] Hi, I'm Maya. One last thought.\n", self.file.read_text())
        self.assertTrue(any(m["type"] == "speaker_status" and m["message"] for m in socket.sent))

    async def test_persistence_failure_is_not_retried_or_reported_as_saved(self):
        self.tracker.identify = AsyncMock(return_value=[{"person": "Maya", "text": "Speech.", "timestamp": ""}])
        socket = FakeSocket()
        with patch.object(main, "append_batch", side_effect=OSError("disk full")) as append:
            await main.transcribe(socket)
        self.assertEqual(append.call_count, 1)
        self.assertEqual(socket.code, 1011)
        self.assertFalse(main.recording_active)
        self.assertFalse(any(m["type"] == "speakers" for m in socket.sent))

    async def test_reset_rejected_while_recording_and_clears_voice_registry_when_idle(self):
        main.recording_active = True
        with self.assertRaises(HTTPException) as error:
            await main.reset()
        self.assertEqual(error.exception.status_code, 409)
        main.recording_active = False
        self.tracker.context = "my name is Maya"
        await main.reset()
        self.assertEqual(self.file.read_text(), "")
        self.assertEqual(self.tracker.context, "")

    async def test_second_recorder_cannot_claim_the_room(self):
        main.recording_active = True
        socket = FakeSocket()
        await main.transcribe(socket)
        self.assertEqual(socket.code, 1008)
        self.assertEqual(self.stt.audio_count, 0)

    async def test_attribution_runs_in_background_and_stop_waits_for_pending_batches(self):
        started = asyncio.Event()
        release = asyncio.Event()

        async def identify(pcm, fragments):
            started.set()
            await release.wait()
            return [{"person": "Maya", "text": " ".join(f["text"] for f in fragments), "timestamp": ""}]

        self.tracker.identify = identify
        socket = FakeSocket([{"type": "websocket.receive", "bytes": b"\x01\x00" * 24000 * 3}])
        with patch.object(main, "WRITE_INTERVAL_SECONDS", 0.02):
            recording = asyncio.create_task(main.transcribe(socket))
            try:
                await asyncio.wait_for(started.wait(), 1)
                await socket.messages.put({"type": "websocket.receive", "bytes": b"\x01\x00" * 24000})
                await asyncio.sleep(0.04)
                self.assertEqual(self.stt.audio_count, 2, "Audio must flow while names are being matched")
                await socket.messages.put({"type": "websocket.receive", "text": '{"action":"stop"}'})
                await asyncio.sleep(0.04)
                self.assertIsNone(socket.code, "Stop must await attribution and persistence")
                release.set()
                await asyncio.wait_for(recording, 1)
            finally:
                recording.cancel()
                await asyncio.gather(recording, return_exceptions=True)
        self.assertEqual(socket.code, 1000)
        self.assertEqual(self.file.read_text().count("Hi, I'm Maya."), 2)
        self.assertEqual(self.file.read_text().count("One last thought."), 1)

    async def test_storm_saves_agent_entry_after_speech_and_sends_one_intervention(self):
        self.tracker.identify = AsyncMock(return_value=[{"person": "Maya", "text": "A thought.", "timestamp": ""}])
        main.app.state.storm = StormAgent("test-key", "test-model")
        main.app.state.storm.check = AsyncMock(return_value={"text": STORM_COMMENT, "reason": "repetitive"})
        socket = FakeSocket([{"type": "websocket.receive", "bytes": b"\x01\x00" * 24000}])
        delivered = asyncio.Event()
        original_send = socket.send_json

        async def send(message):
            await original_send(message)
            if message["type"] == "storm":
                self.assertIn(f"[Agent Storm] {STORM_COMMENT}\n", self.file.read_text())
                delivered.set()
        socket.send_json = send
        with patch.object(main, "STORM_TICK_SECONDS", 0.03):
            recording = asyncio.create_task(main.transcribe(socket))
            try:
                await asyncio.wait_for(delivered.wait(), 1)
                await socket.messages.put({"type": "websocket.receive", "text": '{"action":"stop"}'})
                await asyncio.wait_for(recording, 1)
            finally:
                recording.cancel()
                await asyncio.gather(recording, return_exceptions=True)
        self.assertEqual(socket.code, 1000)
        self.assertEqual(self.file.read_text().count("[Agent Storm]"), 1)
        self.assertLess(self.file.read_text().index("[Maya]"), self.file.read_text().index("[Agent Storm]"))
        self.assertEqual([m["agent"] for m in socket.sent if m["type"] == "storm"], ["storm"])

    async def test_slow_storm_does_not_block_memo_and_cannot_interrupt_after_stop(self):
        self.tracker.identify = AsyncMock(return_value=[{"person": "Maya", "text": "All speech saved.", "timestamp": ""}])
        main.app.state.storm = StormAgent("test-key", "test-model")
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def check(now):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        main.app.state.storm.check = check
        socket = FakeSocket([{"type": "websocket.receive", "bytes": b"\x01\x00" * 24000}])
        with patch.object(main, "STORM_TICK_SECONDS", 0.02):
            recording = asyncio.create_task(main.transcribe(socket))
            try:
                await asyncio.wait_for(started.wait(), 1)
                await socket.messages.put({"type": "websocket.receive", "bytes": b"\x01\x00" * 24000})
                await socket.messages.put({"type": "websocket.receive", "text": '{"action":"stop"}'})
                await asyncio.wait_for(recording, 1)
            finally:
                recording.cancel()
                await asyncio.gather(recording, return_exceptions=True)
        self.assertEqual(self.stt.audio_count, 2)
        self.assertTrue(cancelled.is_set())
        self.assertEqual(socket.code, 1000)
        self.assertFalse(any(m["type"] == "storm" for m in socket.sent))
        self.assertNotIn("[Agent Storm]", self.file.read_text())


if __name__ == "__main__":
    unittest.main()
