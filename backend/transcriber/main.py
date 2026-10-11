"""Project-scoped recording with live text and audio-backed speaker attribution."""

import asyncio
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import gradium
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket

from speakers import AudioBuffer, SpeakerTracker, UNKNOWN, format_lines, unknown_lines
from storm import StormAgent

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

WRITE_INTERVAL_SECONDS = 5
DRAIN_SECONDS = 5
STORM_TICK_SECONDS = 1
TRANSCRIPT_FILE = Path(__file__).resolve().parents[2] / "data" / "transcript.txt"
logger = logging.getLogger("uvicorn.error")
guard = asyncio.Lock()
recording_active = False


async def file_operation(function, *args, **kwargs):
    # Cancellation must not release the guard while its worker still touches the file.
    async with guard:
        task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise


def transcript_path(session_id: str = "Hackathon") -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", session_id):
        raise HTTPException(422, "Invalid storm ID")
    return TRANSCRIPT_FILE if session_id == "Hackathon" else TRANSCRIPT_FILE.parent / "storms" / session_id / "transcript.txt"


def session_agents(session_id, path):
    if session_id == "Hackathon":
        return app.state.speakers, app.state.storm
    if not hasattr(app.state, "sessions"):
        app.state.sessions = {}
    if session_id not in app.state.sessions:
        previous = path.read_text(encoding="utf-8") if path.exists() else ""
        next_speaker = next_speaker_number(previous)
        app.state.sessions[session_id] = (SpeakerTracker(
            os.getenv("GEMINI_API_KEY", "").strip(),
            os.getenv("SPEAKER_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-3.8-flash",
            next_speaker=next_speaker,
        ), StormAgent.from_environment())
    return app.state.sessions[session_id]


def next_speaker_number(transcript):
    return max([0, *map(int, re.findall(r"^(?:\[[0-9][^\]\n]*\]\s+)?\[Speaker (\d+)\]", transcript, re.MULTILINE))]) + 1


def append_batch(text, path=None):
    path = path or TRANSCRIPT_FILE
    with path.open("a", encoding="utf-8") as output:
        output.write(text + "\n")
        output.flush()


def replace_transcript(path=None):
    path = path or TRANSCRIPT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".txt.tmp")
    try:
        temporary.write_text("", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@asynccontextmanager
async def lifespan(app):
    app.state.api_key = os.getenv("GRADIUM_API_KEY", "").strip()
    if app.state.api_key.startswith(("your-", "your_")):
        app.state.api_key = ""
    TRANSCRIPT_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRANSCRIPT_FILE.touch(exist_ok=True)
    previous = TRANSCRIPT_FILE.read_text(encoding="utf-8")
    next_speaker = next_speaker_number(previous)
    app.state.speakers = SpeakerTracker(
        os.getenv("GEMINI_API_KEY", "").strip(),
        os.getenv("SPEAKER_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-3.8-flash",
        next_speaker=next_speaker,
    )
    app.state.storm = StormAgent.from_environment()
    app.state.sessions = {}
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ready", "recording": recording_active, "api_revision": "project-transcripts-v2"}


@app.get("/transcript")
async def transcript(session_id: str = "Hackathon"):
    path = transcript_path(session_id)
    try:
        return {"transcript": await file_operation(path.read_text, encoding="utf-8") if path.exists() else ""}
    except OSError as exc:
        logger.error("Cannot read transcript: %s", exc)
        raise HTTPException(500, "Cannot read transcript") from exc


@app.post("/transcript/reset")
async def reset(session_id: str = "Hackathon"):
    path = transcript_path(session_id)
    # Ownership check and replacement are atomic relative to Start and final saving.
    async with guard:
        if recording_active:
            raise HTTPException(409, "Stop recording and wait for saving before resetting the transcript")
        try:
            replace_transcript(path)
            speakers, storm = session_agents(session_id, path)
            speakers.clear()
            storm.clear()
        except OSError as exc:
            logger.error("Cannot reset transcript: %s", exc)
            raise HTTPException(500, "Cannot reset transcript") from exc
    return {"status": "reset"}


@app.websocket("/ws/transcribe")
async def transcribe(ws: WebSocket, session_id: str = "Hackathon"):
    global recording_active
    await ws.accept()
    try:
        path = transcript_path(session_id)
    except HTTPException:
        await ws.close(code=1008)
        return
    if not app.state.api_key:
        await ws.send_json({"type": "error", "message": "Set GRADIUM_API_KEY in the root .env and restart the transcriber to record. Saved transcripts remain available."})
        await ws.close(code=1008)
        return
    async with guard:
        if recording_active:
            await ws.send_json({"type": "error", "message": "Recording already active"})
            await ws.close(code=1008)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)
        speakers, storm = session_agents(session_id, path)
        recording_active = True

    fragments = []
    audio_buffer = AudioBuffer()
    recording_id = uuid4().hex
    recording_started_at = None
    fragment_number = 0
    attribution = None
    connected = True
    failure = None
    persistence_failed = False
    stt = None
    sender = receiver = eos = None
    storm_task = None
    storm.start()
    loop = asyncio.get_running_loop()

    async def caption(message):
        nonlocal connected
        if connected:
            try:
                await asyncio.wait_for(ws.send_json(message), timeout=1)
            except (Exception, asyncio.CancelledError):
                connected = False
                # Main-task cancellation still needs to reach the final save.
                if asyncio.current_task().cancelling():
                    raise

    async def receive_audio():
        nonlocal connected, recording_started_at
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                connected = False
                return
            if message.get("bytes") is not None:
                audio = message["bytes"]
                if len(audio) % 2:
                    raise RuntimeError("Audio must be mono signed 16-bit PCM at 24 kHz")
                if recording_started_at is None:
                    # Anchor the provider's audio offsets to the first captured audio,
                    # so transcription/network delays never shift the recorded time.
                    recording_started_at = datetime.now(timezone.utc) - timedelta(seconds=len(audio) / 48000)
                audio_buffer.append(audio)
                await asyncio.wait_for(stt.send_audio(audio), timeout=5)
            elif message.get("text") is not None:
                action = json.loads(message["text"]).get("action")
                if action == "stop":
                    return
                if action == "flush":
                    await asyncio.wait_for(stt.send_flush(), timeout=5)

    async def watch_focus():
        warned = False
        while True:
            await asyncio.sleep(STORM_TICK_SECONDS)
            previous_check = storm.last_check
            try:
                intervention = await storm.check(loop.time())
            except Exception as exc:
                warned = True
                logger.warning("Storm assessment failed (%s)", type(exc).__name__)
                await caption({"type": "storm_status", "message": "Storm is temporarily unavailable. Memo is still listening."})
                continue
            if warned and storm.last_check != previous_check:
                warned = False
                await caption({"type": "storm_status", "message": ""})
            if not intervention:
                continue
            # Never deliver an old decision after pause, disconnect, or shutdown.
            if not connected or sender.done():
                return
            # Finish pre-intervention speaker turns first so saved and live order agree.
            if attribution is not None:
                await asyncio.shield(attribution)
            schedule_batch("before Storm")
            if attribution is not None:
                await asyncio.shield(attribution)
            if not connected or sender.done():
                return
            timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
            await file_operation(append_batch, format_lines([{"person": "Agent Storm", "text": intervention['text'], "timestamp": timestamp}]), path)
            await caption({"type": "storm_status", "message": ""})
            await caption({"type": "storm", "agent": "storm", "person": "Storm",
                           "id": f"storm-{uuid4().hex}", "timestamp": timestamp,
                           **intervention})

    async def save_batch(batch, pcm, reason):
        nonlocal persistence_failed
        if not batch or persistence_failed:
            return
        try:
            lines = await speakers.identify(pcm, batch)
            await caption({"type": "speaker_status", "message": ""})
        except Exception as exc:
            # Attribution must never drop speech or silently assign it to the last person.
            speakers.context = ""
            lines = unknown_lines(batch)
            message = str(exc) if isinstance(exc, RuntimeError) else "Speaker identification failed; this passage is saved as Unknown speaker."
            logger.warning("Speaker identification failed (%s)", type(exc).__name__)
            await caption({"type": "speaker_status", "message": message})
        text = format_lines(lines)
        # Do not retry if an append partially succeeds before failing.
        try:
            await file_operation(append_batch, text, path)
        except OSError as exc:
            persistence_failed = True
            raise RuntimeError(f"Transcript persistence failed: {exc}") from exc
        storm.attribute([item["id"] for item in batch], text)
        await caption({"type": "speakers", "replace_ids": [item["id"] for item in batch],
                       "lines": [dict(line, id=f"{batch[0]['id']}-{index}") for index, line in enumerate(lines)]})
        logger.info("Saved %s batch (%d chars)", reason, len(text))

    def schedule_batch(reason):
        nonlocal attribution
        if attribution is not None:
            if not attribution.done():
                return
            attribution.result()
            attribution = None
        if not fragments or persistence_failed:
            return
        batch = fragments[:]
        fragments.clear()
        # Retain context around the boundary, including introductions split between batches.
        first_speech = min(item["start_s"] for item in batch)
        actual_start, pcm = audio_buffer.clip(max(0, first_speech - 3), audio_buffer.duration)
        if actual_start > first_speech:
            pcm = b""  # The provider lagged beyond our window; do not match unrelated audio.
        attribution = asyncio.create_task(save_batch(batch, pcm, reason))

    try:
        stt = gradium.GradiumClient(api_key=app.state.api_key).stt_realtime(
            model_name="default", input_format="pcm",
            json_config={"language": "en"}, wait_for_ready_on_start=True,
        )
        await asyncio.wait_for(stt.__aenter__(), timeout=10)
        await caption({"type": "ready"})
        if not speakers.api_key:
            await caption({"type": "speaker_status", "message": "Set GEMINI_API_KEY and restart the transcriber to identify speakers."})
        sender = asyncio.create_task(receive_audio())
        if storm.available:
            storm_task = asyncio.create_task(watch_focus())
        elif storm.enabled:
            await caption({"type": "storm_status", "message": "Set GEMINI_API_KEY and restart the transcriber to enable Storm."})
        receiver = asyncio.create_task(stt.recv())
        next_write = loop.time() + WRITE_INTERVAL_SECONDS
        drain_deadline = None
        while True:
            if drain_deadline is None and (sender.done() or not connected):
                if sender.done():
                    sender.result()
                else:
                    sender.cancel()
                    await asyncio.gather(sender, return_exceptions=True)
                drain_deadline = loop.time() + DRAIN_SECONDS
                eos = asyncio.create_task(stt.send_eos())
            deadline = min(next_write, drain_deadline or float("inf"))
            tasks = {receiver}
            if attribution is not None:
                tasks.add(attribution)
            if drain_deadline is None:
                tasks.add(sender)
            if eos is not None:
                tasks.add(eos)
            if storm_task is not None and drain_deadline is None:
                tasks.add(storm_task)
            done, _ = await asyncio.wait(tasks, timeout=max(0, deadline - loop.time()),
                                         return_when=asyncio.FIRST_COMPLETED)
            if eos in done:
                eos.result()
                eos = None
            if attribution in done:
                attribution.result()
                attribution = None
            if storm_task in done:
                storm_task.result()
                storm_task = None
            if receiver in done:
                message = receiver.result()
                if message is None or message.get("type") == "end_of_stream":
                    break
                if message.get("type") == "error":
                    raise RuntimeError(f"Gradium: {message.get('message', message)}")
                if message.get("type") == "text":
                    text = " ".join(message.get("text", "").split())
                    if text:
                        fragment_number += 1
                        start_s = message.get("start_s", max(0, audio_buffer.duration - 5))
                        timestamp = ((recording_started_at or datetime.now(timezone.utc)) + timedelta(seconds=start_s)).isoformat(timespec="milliseconds")
                        fragment = {"id": f"{recording_id}-{fragment_number}", "text": text,
                                    "start_s": start_s, "timestamp": timestamp}
                        fragments.append(fragment)
                        if drain_deadline is None:
                            storm.observe(text, loop.time(), fragment["id"])
                        await caption({"type": "transcript", **fragment, "person": UNKNOWN, "pending": True})
                receiver = asyncio.create_task(stt.recv())
            if loop.time() >= next_write:
                schedule_batch("periodic")
                # Advance to the next future deadline, without catch-up writes.
                next_write += (int((loop.time() - next_write) / WRITE_INTERVAL_SECONDS) + 1) * WRITE_INTERVAL_SECONDS
            if drain_deadline is not None and loop.time() >= drain_deadline:
                raise RuntimeError("Gradium shutdown timed out; received text was saved, but final results may be incomplete")
    except asyncio.CancelledError:
        failure = "Recording interrupted by server shutdown"
        raise
    except Exception as exc:
        failure = str(exc)
        logger.error("Recording failed: %s", failure)
    finally:
        tasks = [task for task in (sender, receiver, eos, storm_task) if task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        try:
            if attribution is not None:
                await attribution
                attribution = None
            schedule_batch("final")
            if attribution is not None:
                await attribution
        except Exception as exc:
            failure = str(exc)
            logger.error("Final save failed: %s", failure)
        if stt is not None:
            try:
                # __aenter__ can fail after opening the SDK's HTTP session.
                await asyncio.wait_for(stt.__aexit__(None, None, None), timeout=2)
            except Exception as exc:
                failure = failure or f"Gradium connection cleanup failed: {exc}"
                logger.error("%s", failure)
        async with guard:
            recording_active = False
        if failure:
            await caption({"type": "error", "message": failure})
        if connected:
            try:
                await ws.close(code=1011 if failure else 1000)
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("TRANSCRIBER_HOST", "0.0.0.0"),
        port=int(os.getenv("TRANSCRIBER_PORT", "8010")),
        timeout_graceful_shutdown=60,
    )
