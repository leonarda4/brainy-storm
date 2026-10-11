# Browser recording server

The microphone lives in the browser. This FastAPI service streams incoming 24 kHz mono signed 16-bit PCM to Gradium, matches speakers using Gemini audio, and appends speaker-labeled text to `data/storms/<session_id>/transcript.txt`.

Set `GRADIUM_API_KEY` and `GEMINI_API_KEY` in the **repository root `.env`**. All services share that file; `backend/transcriber/.env` is no longer loaded. Existing process environment variables take precedence. Restart running services after changing keys. From this directory:

```bash
uv run python main.py
```

The service listens on port 8010 with **one worker** (`TRANSCRIBER_PORT` overrides it). Vite uses the same local default; Docker explicitly uses port 8000 internally. Use the frontend's Start, Pause/Resume, and Restart buttons. For the complete prototype, follow the root README and run `docker compose up --build`.

### Memo and Storm

**Memo** is the listening/transcription agent, shown as cyan bubbles. **Storm** is
the focus agent running independently in the same service. It watches fresh speech
with the existing `GEMINI_API_KEY`; `STORM_MODEL` optionally overrides
`GEMINI_FAST_MODEL`, then `GEMINI_MODEL`. `STORM_ENABLED=false` disables it.
No additional process or voice API key is needed.
As speaker attribution completes, its raw conversation fragments are replaced
with the same named turns sent to the transcript and downstream idea agents,
without counting the speech twice.

After at least 45 seconds and 80 words, Storm checks focus at most every 20 seconds,
requiring at least 25 new words and speech in the last 15 seconds. Two confident
checks must agree that discussion is sidetracked or repetitive. Staying on one
aspect for three minutes can also qualify if the team is making no progress.
Useful disagreement and productive exploration should not trigger it. After an
intervention, Storm waits at least two minutes. Pause/resume clears old discussion
evidence but preserves this cooldown; restarting the session resets both.

For easier live testing, set `STORM_TEST_MODE=true` in the root `.env` and restart
the transcriber. Storm can then interrupt after about **60 seconds** and 40 words
with one assessment at confidence 0.7 or above. It rechecks at most every 10 seconds
with at least 10 new words; speech must still be recent. The stalled-focus budget
also becomes one minute, and the **two-minute cooldown** still applies. Actual
delivery includes model and speaker-attribution latency. Set the flag to `false`
to restore normal thresholds.

Technical explanations count as progress when they help develop the current idea
or explain a concrete limitation, risk, or feasibility constraint. Detailed
technical tangents without that connection count as sidetracked even when the
speaker keeps adding facts. Productive exploration and necessary explanations
remain on track in both modes.

Storm says: “This isn't going anywhere. Please proceed either with another aspect
of the idea or just move on to another idea.” The browser speaks this using its
English speech-synthesis voice. Connected hot-pink diamonds replace Memo's bubbles
with the same pulsing motion, and the reminder appears above the recording controls.
Microphone PCM is replaced with silence during playback and for a 350 ms tail so
Storm's voice cannot enroll as a participant or repeat in the transcript. Memo
resumes automatically. Pause, disconnect, and page teardown cancel the voice.
If browser speech is unavailable, blocked, or times out, the reminder stays visible
for eight seconds and a warning appears; microphone capture continues.

The service saves each intervention once as `[Agent Storm] ...` and sends a `storm`
WebSocket event with an ID, text, reason, and timestamp. Reloads/export retain the
agent label, while the classifier excludes these entries from idea context.
`storm_status` carries nonfatal focus-provider warnings. Provider failures do not
interrupt transcription or invent an intervention.

Storage is one local file per storm at `data/storms/<session_id>/transcript.txt`; no remote transcript database is used. Pass `session_id` on the transcript, reset, and recording WebSocket endpoints. Omitting it preserves the legacy `data/transcript.txt` behavior. Speaker references and focus-agent context are isolated by storm. Existing demo text can be read and exported without API keys. Missing recording credentials produce an error only when recording is requested, so they cannot prevent reading a saved transcript. Live recording still sends audio to Gradium and to Gemini for speaker attribution. The file is not ignored by Git and can be committed as demo data; `.env` remains ignored.

Each person should introduce themselves naturally once (for example, “Hi, it's Maya”, “I'm Maya”, or “My name is Maya”) and continue speaking for a few seconds, one person at a time. No “speaking” suffix or special wording is required. Gemini matches subsequent speech to short audio references, including when a previous speaker returns. Merely mentioning someone else's name does not enroll a speaker. Voices without an introduction are stored as `Speaker 1`, etc.; ambiguous speech is stored as `Unknown speaker`. The panel displays these as **Unknown** with a question-mark avatar, retaining distinct colors for numbered voices.

When loading older recordings, the panel recovers natural introductions and applies
the name to other turns with the same numbered voice label. It leaves conflicting
names unresolved and does not carry a name onto unrelated or generic unknown speech.

Provisional captions are streamed immediately but remain hidden in the panel behind one **Someone is speaking** indicator. The panel displays the merged chunk and its speaker after the five-second batching interval plus the model's response time. It supports a named speaking indicator when pending captions include a known identity; this service currently identifies names only at batch completion. Recognition is probabilistic and works best with clear, non-overlapping speech. A missing key, timeout, invalid result, or provider failure preserves the transcript as `Unknown speaker` and displays a warning. `SPEAKER_MODEL` overrides the audio model; otherwise the service uses `GEMINI_MODEL`, then `gemini-3.8-flash`.

Reference clips (up to five seconds each, at most 16 voices) are held in server memory and sent to Gemini with subsequent audio batches. They survive pause/resume and browser reloads while this server stays running. Restarting the **session** clears them; restarting the **server** requires fresh introductions. No audio is written to disk by this service. Names already saved in the transcript remain available after either a reload or server restart.

| Interface | Behavior |
| --- | --- |
| WebSocket `/ws/transcribe` | Start: claim the single recording slot, connect Gradium, send `{"type":"ready"}`, then accept binary PCM. A second recorder receives an error. |
| Socket `{"action":"stop"}` | Send end-of-stream once, drain Gradium for up to five seconds, await pending attribution and saving, close normally. Disconnects also drain and save. Speaker requests time out after 20 seconds each; the browser allows 60 seconds for completion. |
| Socket `{"action":"flush"}` | Request a provider flush; file writes still follow the timer. |
| `GET /transcript` | `{"transcript":"..."}` containing only persisted text. |
| `POST /transcript/reset` | Atomically replace the transcript with an empty file. Return 409 during recording initialization, capture, or final saving. Keep ideas. |
| `GET /health` | Local readiness without contacting Gradium. |

Live captions use `{"type":"transcript","id":"...","text":"...","person":"Unknown speaker","pending":true,"timestamp":"HH:MM:SS"}`. Attribution sends `{"type":"speakers","replace_ids":["..."],"lines":[{"id":"...","person":"Maya","text":"...","timestamp":"HH:MM:SS"}]}` to replace pending captions in place. `speaker_status` carries nonfatal attribution warnings; an empty message clears the warning. Fatal failures use `{"type":"error","message":"..."}` and an abnormal close. A normal close confirms the final save. Gradium shutdown timeout is reported as incomplete transcription; already received text is saved.

`WRITE_INTERVAL_SECONDS = 5` controls batching. Only one attribution request runs at a time while new audio and text continue arriving. Each batch appends one line per speaker turn (`[Maya] Words spoken.`) without a timestamp, after attribution finishes. Original Gradium words are preserved exactly once; the model only assigns word ranges to speakers. Silence writes nothing. Start and service startup preserve existing contents; only Reset clears them. Old unlabeled transcripts remain readable as **Unknown**; the panel recovers existing timestamped speaker labels and explicit self-introductions. Read endpoints coordinate with writes. Direct file consumers must wait for a terminating newline before consuming an entry.

A failed file append terminates recording and is not retried because it may have partially succeeded. Pending text is in memory and cannot survive a forced process kill. Run only one transcriber process against the file.

Run regression checks with `uv run python -m unittest discover -s . -p 'test_*.py'`.
