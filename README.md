# brainy storm: make brainstorming productive

## What this is

**brainy storm** is a shared workspace that turns a team's spoken brainstorming session into organized, evolving ideas. People stay in the conversation while AI handles transcription, idea tracking, summaries, arguments, competitor research, open questions, and system design.

Each idea receives a stable ID and its own record containing the relevant transcript excerpts, current summary, categorized pros and cons, assumptions, open questions, competitors, workflow, system architecture, thumbnail, and generated artifacts.

<img width="1920" height="1080" alt="system-architecture-3" src="https://github.com/user-attachments/assets/6eaa1004-847e-4433-bd16-bbe42d5f9aad" />


## Architecture

The live loop is:

```text
Browser microphone
  -> Gradium transcriber
  -> data/storms/<project-id>/transcript.txt
  -> Gemini idea classifier
  -> pubsub/classified-chunks.jsonl
  -> enrichment router and queue
  -> parallel Gemini enrichment agents
  -> data/ideas.json + data/ideas/<idea-id>/
  -> React idea board
```

<img width="8200" height="7840" alt="brainy_storm_eng" src="https://github.com/user-attachments/assets/78cfd2ba-5f14-4fba-aeca-2737b1f23984" />

### Agentic behavior

- New idea IDs run the complete enrichment pipeline.
- Existing ideas append only their relevant transcript excerpt.
- The decision router always refreshes the summary and selects only downstream sections affected by new discussion.
- Different ideas are processed concurrently; updates for the same idea remain FIFO.
- Stable chunk IDs, transcript segments, and worker offsets prevent repeated processing.
- Competitor research uses grounded search and stores its source URLs.
- Memo listens with cyan bubbles. Storm watches for stalled or sidetracked discussion,
  speaks a brief focus reminder, and takes over with connected hot-pink diamonds.
  Its comments are saved as agent turns in the transcript. See the
  [Memo and Storm settings](backend/transcriber/README.md#memo-and-storm).
- The frontend displays backend-generated static SVG workflow and architecture diagrams; browser-side interactive maps are intentionally disabled.

## Run the complete live demo locally

### Prerequisites

- Python 3.13 and [`uv`](https://docs.astral.sh/uv/)
- Node.js 22
- A browser with microphone permission
- Gradium and Gemini API keys

Create `.env` in the repository root:

```dotenv
GRADIUM_API_KEY=your_gradium_api_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
```

Never commit `.env`; it is ignored by Git.

This is the single shared environment file for the frontend, transcriber, idea
engine, and enrichment services, regardless of the directory you launch them
from. Service-local `.env` files are not needed. Restart running services after
changing it. Keep provider keys named `GRADIUM_API_KEY` and `GEMINI_API_KEY`;
only public frontend settings should use the `VITE_` prefix.

The Gradium key enables transcription. Speaker recognition uses `GEMINI_API_KEY`:
each participant introduces themselves once and keeps speaking for a few seconds.
The service compares later speech with that voice sample and saves named speaker
turns. Automatic idea creation and memory updates also require the idea classifier and the
classified-chunk worker. Each key should appear only once in `.env`.

### Start everything locally with one command

Install dependencies once from the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
uv sync --project backend/transcriber --frozen
uv sync --project backend/engine --frozen
npm ci --prefix frontend
```

Then, for each session:

```bash
./dev
```

Keep that terminal open. The launcher validates the two required keys and
dependencies, starts all five services, and checks the browser's API proxy
routes before printing the app URL. It reuses processes already running from
this checkout, refuses duplicate services or occupied ports, and reports a
process exit instead of silently leaving an incomplete pipeline running.
It deliberately does not automatically restart the classifier, because a
classifier restart resets its pub/sub topics. Fix the reported error and run
`./dev` again. New process logs are in `.runtime/<service>.log`.

Check the stack at any time in another terminal:

```bash
./dev status
```

This checks every process, backend health, browser API routes, the remaining
classified-chunk backlog, and failed enrichment jobs. A nonzero exit status
means a service or check failed. A backlog can be normal while models are
working; it should shrink when recording is paused. Health checks do not
guarantee provider availability or model accuracy; use the model ping below
after changing credentials or models.

Pause stops microphone capture and saves the final transcript. The classifier,
forwarding worker, enrichment jobs, and frontend polling continue while paused.
Before ending a session, pause recording and wait for the backlog and running
jobs to reach zero. Ctrl-C stops services launched by `./dev`, allowing up to
65 seconds for shutdown. Services it reused are left running in their original
terminals. Restart those separately after editing `.env`; reuse does not reload
their configuration. Use only one launcher per checkout and do not mix it with
Docker against the same data files.

### Start everything with Docker

With Docker running and both keys in the root `.env`:

```bash
docker compose up --build
```

This starts all five services: frontend, transcriber, classifier, Python
enrichment API, and classified-chunk worker. The classifier and worker share
`pubsub/`; the transcriber, classifier, and API share `data/`. Open
http://localhost:5173. Use either Docker or the local launcher/processes,
so two classifiers do not process the same transcript.

### Run the services separately

Install shared Python and frontend dependencies once:

```bash
pip install -r requirements.txt
cd frontend && npm ci && cd ..
```

Run each block in a separate terminal from the repository root (Bash, Zsh, or Git Bash).

### 1. Transcription server

Port `8010` avoids conflicts with software commonly using port `8000`:

```bash
cd backend/transcriber
uv run python main.py
```

### 2. Gemini enrichment API

```bash
python -m uvicorn backend.enrichment.main:app --host 127.0.0.1 --port 8001 --reload
```

### 3. Gemini idea classifier

```bash
cd backend/engine
uv run python main.py
```

### 4. Automatic enrichment router

```bash
python -m backend.enrichment.classified_chunks_worker \
  --file pubsub/classified-chunks.jsonl \
  --interval 1
```

### 5. Frontend

```bash
cd frontend
npm run dev
```

Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)** and allow microphone access.

If captions appear but ideas never change, check the classifier terminal first.
`pubsub/classified-chunks.jsonl` should appear after it classifies speech. If
that file grows but the idea database does not, check the classified-chunk
worker and API logs. `/health` confirms that the API is reachable, while
`/models/ping?provider=gemini` verifies its model credentials. Restart the API
and classifier after changing `.env`; running processes keep their old settings.

## Try a brainstorming session

1. Click **Start** and speak about an idea for at least 15–20 seconds.
2. Include what it does, how it works, potential benefits, concerns, competitors, and unresolved questions.
3. Click **Stop** and wait for **Saving…** to finish.
4. The engine processes approximately 500-character chunks, with a ten-second idle flush for smaller remainders.
5. Allow roughly 30–90 seconds for the full new-idea pipeline. The idea card updates automatically without a browser refresh.
6. Open the card to inspect its summary, pros and cons, open questions, competitors, workflow, architecture, and complete JSON.

Each Storm has its own transcript and ideas, identified by a stable project ID. The prototype supports one active recording at a time; switching projects finishes saving first.

## Health checks

```bash
# Local services
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8001/health

# Same transcription route used by the browser
curl http://127.0.0.1:5173/api/transcriber/transcript

# Real Gemini request
python -m backend.enrichment.ping_models --provider gemini
curl -sS "http://127.0.0.1:8001/models/ping?provider=gemini" | python -m json.tool
```

## Test one complete enrichment directly

```bash
curl -sS -X POST \
  http://127.0.0.1:8001/ideas/idea_pr_bot_01/enrich \
  -H 'content-type: application/json' \
  -d '{}' \
  | python -m json.tool
```

This makes real Gemini and grounded-search calls and may take 30–90 seconds.

## Data and artifacts

Transcripts are stored locally at `data/storms/<project-id>/transcript.txt`. The cleaned original conversation is in `data/storms/team-discussion/transcript.txt`; `data/transcript.txt` remains the legacy default.
Recording appends to that file; browser reloads and service restarts preserve it.
**Pause** waits for the final save, and **Export transcript** downloads a copy.
**Restart** explicitly clears the current transcript. A connection warning does
not mean the saved file was deleted.

For testing just transcript capture, run the transcriber and frontend commands
above without the classifier or classified-chunk worker. This records to the
local file without automatically generating ideas. To view existing transcript
text, the transcriber can start without API keys; live recording still uses
Gradium and Gemini. `./dev` starts the complete idea-processing pipeline and
continues to require both keys.

Transcript text files are eligible for Git; include only the specific conversation you intend to share. Classifier cursor checkpoints are local runtime state. Credentials remain in
the ignored root `.env`. There is no remote transcript storage integration in
this setup.

If the transcript panel reports a connection error, it retries automatically.
Check `http://127.0.0.1:8010/health` and
`http://127.0.0.1:5173/api/transcriber/transcript`. The transcriber and frontend
both default to port 8010 locally; if you change it, set `TRANSCRIBER_PORT` in
the root `.env` and restart both. `TRANSCRIBER_TARGET` takes precedence for the
proxy. The `./dev` launcher uses port 8010 explicitly.

```text
data/
├── transcript.txt
├── ideas.json
└── ideas/
    └── <idea-id>/
        ├── idea.json
        ├── raw-body.txt
        ├── transcript-segments.json
        ├── summary.md
        ├── pros-cons.json
        ├── assumptions-open-questions.md
        ├── competitors.json
        ├── workflow.json
        ├── workflow.svg
        ├── system-architecture.json
        ├── system-architecture.svg
        └── thumbnail.svg
```

The aggregate database is `data/ideas.json`. Every completed save also materializes a frontend-ready per-idea record and artifact folder. The enrichment API generates minimal SVG thumbnails from idea titles in the background, using black and up to two brand colors. Abstract patterns and recognizable subjects mix with bright or black backgrounds and oversized, cropped shapes. Instant abstract placeholders remain visible until the artwork is ready; no summary is required. See [thumbnail configuration](backend/enrichment/README.md) for model settings and retries.

## Verification

```bash
cd frontend
npm run lint
npm run build
node --test src/ideaWorkspace.test.mjs

cd ..
python -m unittest discover -s scripts -p "test_*.py"
python -m unittest discover -s backend/enrichment -p "test_*.py"

cd backend/engine
uv run python -m unittest test_focus -v
```
