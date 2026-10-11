# Idea enrichment backend

This service reads one selected idea from `data/ideas.json` and runs:

```text
messy multi-person transcript
  -> summary
  -> pros/cons (from the transcript)
  -> Mermaid workflow/design (from the summary)
  -> online competitor research (from the summary)
  -> atomic update of the same idea
```

## Bash setup

Run these commands from the repository root. In Git Bash on Windows:

```bash
python -m venv .venv
source .venv/Scripts/activate
python -m pip install -r backend/enrichment/requirements.txt
cp .env.example .env
```

On Linux/macOS, activate with `source .venv/bin/activate` instead. Add a real
`GEMINI_API_KEY` or `OPENAI_API_KEY` to `.env`. `DEFAULT_PROVIDER=auto` prefers
Gemini and falls back to OpenAI. `DEFAULT_PROVIDER=mock` runs the pipeline
offline, but competitor results are then demo data rather than live research.

## Ping the models

These commands make a real minimal inference call and exit non-zero if the key,
model, or network is invalid. They never fall back to mock data.

```bash
python -m backend.enrichment.ping_models --provider gemini
python -m backend.enrichment.ping_models --provider openai
```

Only run the command for the provider you configured. To require both:

```bash
python -m backend.enrichment.ping_models --provider all
```

The pipeline uses `GEMINI_FAST_MODEL=gemini-flash-lite-latest` for routing,
relevance extraction, summaries, and workflow generation. Higher-judgment
pros/cons, architecture, and competitor research use `GEMINI_MODEL`. Override
either value in `.env`. `GROUNDED_SEARCH_TIMEOUT_SECONDS=20` bounds the Google
grounding attempt before competitor research falls back to independently
searched web context.

## Run and test the API

```bash
uvicorn backend.enrichment.main:app --host 0.0.0.0 --port 8001 --reload
```

In a second Bash terminal:

```bash
curl -s http://localhost:8001/health
curl -s 'http://localhost:8001/models/ping?provider=gemini'
```

An idea record needs an `id`, `title`, and its current full `transcript`:

```json
{
  "id": "solar-kiosk",
  "title": "Solar repair kiosk",
  "transcript": "Maya: Commuters need quick repairs. Jon: Solar lowers costs. Lee: Theft is a risk."
}
```

Upsert and enrich that selected idea:

```bash
curl -s -X POST http://localhost:8001/ideas \
  -H 'content-type: application/json' \
  -d '{"id":"solar-kiosk","title":"Solar repair kiosk","transcript":"Maya: Commuters need quick repairs. Jon: Solar lowers costs. Lee: Theft is a risk."}'

curl -s -X POST http://localhost:8001/ideas/solar-kiosk/enrich \
  -H 'content-type: application/json' \
  -d '{}'
```

The enrichment call is synchronous and returns the completed idea. It also
persists `summary`, `pros_cons`, `workflow`, `competitors`, and status back to
`data/ideas.json`. Run the offline verification with:

```bash
python -m unittest backend.enrichment.test_pipeline
```

### Written contributions from the idea editor

`POST /ideas/{identifier}/text-edits` accepts `edit_id` plus an edited `title`
and/or `summary`. For a new browser-created card, also send `is_new: true` and
`idea_title`. It returns `202` with a job ID. Written input bypasses relevance
filtering, joins the per-idea speech queue, and is persisted in `raw_body` and
`transcript_segments` before refreshing summary, pros/cons, workflow,
architecture and competitors. The segment ID is `text-edit:{edit_id}`; clients
keep their draft until that segment appears in `GET /ideas`.

Retries with the same edit ID do not duplicate context. The browser retains
pending edits across reloads and retries until the backend confirms storage.
Contributions are explicitly marked as written input, so agents can use
unspoken details without attributing them to a speaker. The Pros and Cons
agent also generates open questions, key risks and assumptions.

## Test each agent separately

For the included `idea_pr_bot_01` example, run these in order while Uvicorn is
running. Each command returns its result immediately and saves it to
`data/ideas.json`.

```bash
# 1. Transcript -> summary
curl -s -X POST http://127.0.0.1:8001/ideas/idea_pr_bot_01/enrich/summary \
  -H 'content-type: application/json' -d '{}' | python -m json.tool

# 2. Transcript -> pros, cons, risks, and open questions
curl -s -X POST http://127.0.0.1:8001/ideas/idea_pr_bot_01/enrich/pros-cons \
  -H 'content-type: application/json' -d '{}' | python -m json.tool

# 3. Summary -> workflow steps, Mermaid diagram, and image prompt
curl -s -X POST http://127.0.0.1:8001/ideas/idea_pr_bot_01/enrich/workflow \
  -H 'content-type: application/json' -d '{}' | python -m json.tool

# 4. Summary -> online competitor research
curl -s -X POST http://127.0.0.1:8001/ideas/idea_pr_bot_01/enrich/competitors \
  -H 'content-type: application/json' -d '{}' | python -m json.tool
```

## Add or update transcript context by idea ID

`raw_body` is the canonical context for all enrichments. The ingest endpoint
filters a new transcript chunk for the selected ID, appends only relevant
speaker-attributed material to `raw_body`, deduplicates repeated chunks, and
runs the complete enrichment pipeline by default.

Create a new idea from its first transcript chunk:

```bash
curl -s -X POST http://127.0.0.1:8001/ideas/new_idea_01/ingest \
  -H 'content-type: application/json' \
  -d '{"title":"New idea title","transcript":"Maya: Here is the idea... Alex: Here is a risk...","enrich":true}' \
  | python -m json.tool
```

Later, append a mixed transcript delta to the same idea. The title is no longer
required because the ID already exists:

```bash
curl -s -X POST http://127.0.0.1:8001/ideas/new_idea_01/ingest \
  -H 'content-type: application/json' \
  -d '{"transcript":"Maya: Unrelated greeting. Alex: For new_idea_01, we should add an audit log.","enrich":true}' \
  | python -m json.tool
```

Use `"enrich":false` to update `raw_body` without rerunning the four enrichment
agents. Configured provider failures return an error; they are never reported as
successful mock research. Explicit offline demos require `DEFAULT_PROVIDER=mock`.

## Queue classified transcript chunks

Your upstream idea-recognition model submits one transcript chunk plus one match
for every affected idea. New ideas default to the complete pipeline. Existing
ideas default to refreshing only `summary` and `pros_cons`.

Queue a new idea without waiting for enrichment:

```bash
curl -sS -X POST http://127.0.0.1:8001/transcript/chunks \
  -H 'content-type: application/json' \
  -d '{
    "chunk_id":"chunk-001",
    "transcript":"Maya: We should build a solar repair kiosk. Lee: Theft could be a risk.",
    "matches":[{
      "idea_id":"solar-kiosk",
      "is_new":true,
      "title":"Solar repair kiosk",
      "relevant_excerpt":"Maya: We should build a solar repair kiosk. Lee: Theft could be a risk.",
      "reason":"A new product idea and its first risk"
    }]
  }' | python -m json.tool
```

Inspect and drain the queue synchronously:

```bash
curl -sS 'http://127.0.0.1:8001/enrichment/queue/jobs?status=queued' \
  | python -m json.tool

curl -sS -X POST 'http://127.0.0.1:8001/enrichment/queue/drain?wait=true' \
  | python -m json.tool

curl -sS http://127.0.0.1:8001/ideas/solar-kiosk \
  | python -m json.tool
```

Queue a later update for the same idea. Reusing a `chunk_id` is safe and is
reported as `skipped`; a new ID appends exactly one `transcript_segments` entry
and increments `content_version`.

```bash
curl -sS -X POST http://127.0.0.1:8001/transcript/chunks \
  -H 'content-type: application/json' \
  -d '{
    "chunk_id":"chunk-002",
    "transcript":"Alex: The kiosk needs battery storage for evening repairs.",
    "matches":[{
      "idea_id":"solar-kiosk",
      "is_new":false,
      "relevant_excerpt":"Alex: The kiosk needs battery storage for evening repairs."
    }]
  }' | python -m json.tool

curl -sS -X POST 'http://127.0.0.1:8001/enrichment/queue/drain?wait=false' \
  | python -m json.tool
```

`wait=false` starts background processing. Use the returned job IDs with
`GET /enrichment/queue/jobs/{job_id}`. Jobs for different ideas run in
parallel; jobs for the same idea run FIFO under a per-idea lock. To enqueue and
wait in one request, add `"process_now":true` to the chunk payload.

Interactive endpoint schemas are available at
`http://127.0.0.1:8001/docs`. Run all offline endpoint and pipeline tests with:

```bash
python -m unittest discover -s backend/enrichment -p "test_*.py"
```

## Process `classified-chunks.json`

The classifier file is accepted directly. The service checks each fixed idea
ID against storage, so the upstream classifier does not need to send `is_new`.
The one-line `short-summary` is accepted but intentionally not used as
enrichment context.

```bash
curl -sS -X POST http://127.0.0.1:8001/transcript/classified-chunks \
  -H 'content-type: application/json' \
  --data-binary @backend/enrichment/classified-chunks.json \
  | python -m json.tool

curl -sS -X POST 'http://127.0.0.1:8001/enrichment/queue/drain?wait=true' \
  | python -m json.tool
```

Add `"process_now": true` beside `"chunks"` to enqueue and wait in one call.
For a new ID, the service generates summary, categorized pros/cons, workflow,
system architecture, and grounded competitors. For an existing ID, the router
always refreshes the summary and selects only affected downstream sections.

To continuously consume an append-only JSONL topic, keep the Python enrichment
API running and start the classified-chunk router in a second terminal:

```bash
python -m backend.enrichment.classified_chunks_worker \
  --file pubsub/classified-chunks.jsonl \
  --interval 2
```

Each line may contain one `{ "chunk": "...", "ideas": [...] }` object, as in
`pubsub/classified-chunks.example.jsonl`. The router checkpoints its byte offset
beside the input file only after a successful API response. New idea IDs run the
complete pipeline; existing IDs use the decision router to update only affected
sections. Use `--once` for a one-shot test. Replayed chunk content remains safe
because the API also deduplicates stable content-derived chunk IDs per idea.

## Per-idea saved artifacts

The aggregate database remains `data/ideas.json`. Every save also writes the
complete per-idea record to `data/ideas/<idea-id>.json` and materializes an
organized folder at `data/ideas/<idea-id>/` containing, when available:

```text
idea.json
manifest.json
thumbnail.svg
thumbnail.json
raw-body.txt
transcript-segments.json
summary.md
pros-cons.json
pros-cons.md
assumptions-open-questions.md
competitors.json
competitors.md
workflow.json
workflow.mmd
workflow.svg
system-architecture.json
system-architecture.mmd
system-architecture.svg
```

`thumbnail.svg` starts as an instant, deterministic abstract placeholder. While
the Python API is running, an independent background worker scans every three
seconds and generates artwork for new and existing ideas, two at a time. It
uses the **idea title only**: no summary generation or transcript processing
is required. A changed title schedules fresh artwork; summary updates and
reordering cards do not. The existing image remains visible during generation.

Generated thumbnails are minimal 800 × 400 SVG illustrations. A stable choice
per idea mixes abstract squiggly/scalloped patterns, paired organic patterns,
suggestive forms, and occasional recognizable subjects. Style, cropping, and
background are varied independently. Large shapes fill much of the frame and
extend beyond its edges; they need not be centered or linked by connectors.
Black and the two selected brand colors exchange background and ink roles.
Most new thumbnails use just one brand color and black. Occasional accents
are restricted to selected color pairs; a third color is rejected for two-tone
compositions. The preferred reference is the Code Review thumbnail's separated
rounded bars. New work uses one to three simple forms, with a hard ceiling of
five foreground shapes. Paths have a bounded number of commands and coordinates;
compound cutouts and elaborate layered patterns are rejected or discouraged.
The palette uses orange (`#FF7146`), pink (`#F47AFF`), aqua (`#9FF6EE`),
yellow (`#F4FF61`), purple (`#A83CF4`), lemon (`#FFE600`), olive green
(`#9DA51A`), or vivid red (`#FF4545`). The same palette is available to the
abstract placeholders and their optional dots; white is excluded and blue
(`#414DFF`) is reserved for CTA controls, outside these eight supporting colors.
There is no visible text, shading, gradient, or embedded raster image.
An SVG allowlist rejects active content,
external references, unsupported elements, and colors outside the palette.

The existing text-model connection generates the SVG source; this does not
require a Nano Banana image-model call or a new API key. `THUMBNAIL_MODEL`
optionally overrides `GEMINI_MODEL`; with the OpenAI provider, `OPENAI_MODEL`
is used. `THUMBNAIL_TIMEOUT_SECONDS` defaults to 60. Set
`THUMBNAILS_ENABLED=false` to retain local placeholders only. Mock mode or
missing model credentials also leaves placeholders in place.

`thumbnail.json` stores the source hash, palette, art direction, output hash and generation
state. Failed requests retry up to three times with backoff, preserving the
previous image. Removing the `generation` entry from this metadata allows
another attempt after exhausted retries. Pending work survives service restarts
through these files, and results for deleted or renamed ideas are discarded.
The worker runs in the API process; use one API worker with this file store.
The generator version is included in the source hash; v2 refreshes existing v1
thumbnails in the background. The `simple-forms-v3` prompt refinement records a
separate `style_revision` without invalidating completed v2 artwork, preserving
approved thumbnails. Selected existing images can be replaced individually.

The idea's `thumbnail` URL includes an output-hash query parameter after
generation. The frontend's normal polling picks up the replacement without a
page reload, and keeps its built-in `BrandShape` fallback for load errors.
Ordinary saves and artifact downloads preserve finished thumbnails.

List or download them through the API:

```bash
curl -sS http://127.0.0.1:8001/ideas/idea_pr_bot_01/artifacts \
  | python -m json.tool

curl -sS http://127.0.0.1:8001/ideas/idea_pr_bot_01/artifacts/pros-cons.md
```

Time a complete live run for any stored idea:

```bash
python -m backend.enrichment.run_example --idea-id idea_pr_bot_01
```

Transcript-first stages run concurrently. Workflow and competitor research
start as soon as the summary dependency completes. In the included PR-bot
example, this reduced the measured live run from 70.10 seconds to 41.35 seconds.
