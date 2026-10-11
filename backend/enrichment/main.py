import asyncio
import hashlib
import json
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from typing import List, Optional, Dict, Any

from .config import (
    DEFAULT_PROVIDER,
    GEMINI_MODEL,
    GEMINI_FAST_MODEL,
    OPENAI_MODEL,
    SERVER_HOST,
    SERVER_PORT,
    THUMBNAILS_ENABLED,
)
from .models import (
    Idea,
    AutoEnrichRequest,
    ManualEnrichRequest,
    IdeaCreateUpdateRequest,
    TranscriptEnrichRequest,
    IdeaIngestRequest,
    TranscriptChunkDispatchRequest,
    ClassifiedChunksRequest,
    IdeaTextEditRequest,
    RoutedIdeaMatch,
)
from .storage import storage
from .orchestrator import orchestrator
from .job_queue import job_queue
from .llm_client import llm_client
from .thumbnail_worker import ThumbnailWorker


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(ThumbnailWorker(storage).run()) if THUMBNAILS_ENABLED else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

app = FastAPI(
    title="Brainstorming Agentic Enrichment Microservice",
    description="Asynchronous agentic tool calling for real-time brainstorming sessions.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections for live UI push
active_websockets: List[WebSocket] = []
background_queue_tasks: set[asyncio.Task] = set()


def _track_background_task(task: asyncio.Task):
    background_queue_tasks.add(task)
    task.add_done_callback(background_queue_tasks.discard)


async def broadcast_ws(event_dict: Dict[str, Any]):
    disconnected = []
    for ws in active_websockets:
        try:
            await ws.send_json(event_dict)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in active_websockets:
            active_websockets.remove(ws)


# Subscribe orchestrator events to WebSocket broadcast
orchestrator.subscribe(broadcast_ws)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "enrichment",
        "api_revision": "idea-artifacts-v4",
        "default_provider": DEFAULT_PROVIDER,
        "models": {
            "gemini": GEMINI_MODEL,
            "gemini_fast": GEMINI_FAST_MODEL,
            "openai": OPENAI_MODEL,
        },
        "model_ping": "/models/ping?provider=all",
    }


@app.get("/models/ping")
async def ping_models(provider: str = "all"):
    """Perform a minimal live inference request; never substitutes mock data."""
    try:
        return await llm_client.ping_models(provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"{type(exc).__name__}: {str(exc)[:500]}",
        )


@app.get("/ideas", response_model=List[Idea])
async def list_ideas(session_id: Optional[str] = None):
    ideas = await storage.get_all_ideas()
    return ideas if session_id is None else [idea for idea in ideas if idea.session_id == session_id]


@app.get("/ideas/{identifier}", response_model=Idea)
async def get_idea(identifier: str):
    idea = await storage.get_idea(identifier)
    if not idea:
        raise HTTPException(status_code=404, detail=f"Idea '{identifier}' not found.")
    return idea


@app.get("/ideas/{identifier}/artifacts")
async def list_idea_artifacts(identifier: str):
    idea = await storage.get_idea(identifier)
    if not idea:
        raise HTTPException(status_code=404, detail=f"Idea '{identifier}' not found.")
    folder = storage.artifacts.write(idea)
    files = sorted(path.name for path in folder.iterdir() if path.is_file())
    return {
        "idea_id": idea.id,
        "directory": str(folder.resolve()),
        "files": [
            {
                "name": name,
                "url": f"/ideas/{idea.id}/artifacts/{name}",
            }
            for name in files
        ],
    }


@app.get("/ideas/{identifier}/artifacts/{filename}")
async def get_idea_artifact(identifier: str, filename: str):
    idea = await storage.get_idea(identifier)
    if not idea:
        raise HTTPException(status_code=404, detail=f"Idea '{identifier}' not found.")
    if filename != Path(filename).name:
        raise HTTPException(status_code=400, detail="Invalid artifact filename.")
    folder = storage.artifacts.write(idea)
    target = folder / filename
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"Artifact '{filename}' not found.")
    return FileResponse(target)


@app.post("/ideas", response_model=Idea)
async def create_or_update_idea(payload: IdeaCreateUpdateRequest):
    existing = None
    if payload.id:
        existing = await storage.get_idea(payload.id)
    if not existing and payload.title:
        existing = await storage.get_idea(payload.title)

    if existing:
        existing.title = payload.title
        if payload.short_summary is not None:
            existing.short_summary = payload.short_summary
        if payload.summary is not None:
            existing.summary = payload.summary
        if payload.transcript is not None:
            existing.transcript = payload.transcript
        if payload.raw_body is not None:
            existing.raw_body = payload.raw_body
        if payload.proponents:
            existing.proponents = payload.proponents
        if payload.opponents:
            existing.opponents = payload.opponents
        if payload.thumbnail:
            existing.thumbnail = payload.thumbnail
        saved = await storage.save_or_update_idea(existing)
        return saved
    else:
        new_idea = Idea(
            id=payload.id or payload.title.lower().replace(" ", "-"),
            title=payload.title,
            short_summary=payload.short_summary,
            summary=payload.summary or "",
            transcript=payload.transcript,
            raw_body=payload.raw_body or payload.transcript or "",
            proponents=payload.proponents,
            opponents=payload.opponents,
            thumbnail=payload.thumbnail
        )
        saved = await storage.save_or_update_idea(new_idea)
        return saved


@app.post("/ideas/{identifier}/ingest")
async def ingest_idea_transcript(identifier: str, payload: IdeaIngestRequest):
    """Filter a transcript delta into an idea raw body and optionally run all enrichments."""
    try:
        return await orchestrator.ingest_transcript_delta(
            identifier=identifier,
            title=payload.title,
            transcript_delta=payload.transcript,
            enrich=payload.enrich,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"{type(exc).__name__}: {str(exc)[:500]}",
        )


@app.post("/ideas/{identifier}/text-edits", status_code=202)
async def submit_idea_text_edit(identifier: str, payload: IdeaTextEditRequest):
    """Queue explicit written input without asking the context agent to filter it.

    The browser keeps its durable draft until a matching transcript segment is
    visible. The normal per-idea queue serializes this with incoming speech.
    """
    existing = await storage.get_idea(identifier)
    if existing and existing.session_id != payload.session_id:
        raise HTTPException(status_code=409, detail="The idea belongs to another storm.")
    if not payload.is_new and not existing:
        raise HTTPException(status_code=404, detail=f"Idea '{identifier}' not found.")
    fields = payload.model_dump(include={"title", "summary"}, exclude_none=True)
    context = (
        "User written contribution (not spoken; edited fields supersede earlier descriptions):\n"
        + json.dumps(fields, ensure_ascii=False)
    )
    job = await job_queue.enqueue(
        chunk_id=f"text-edit:{payload.edit_id}",
        source_transcript=context,
        match=RoutedIdeaMatch(
            session_id=payload.session_id,
            idea_id=identifier,
            is_new=payload.is_new,
            title=payload.idea_title if payload.is_new else None,
            relevant_excerpt=context,
            reason="User added or corrected idea text",
            text_edit=payload,
            tools=["summary", "pros_cons", "workflow", "architecture", "competitors"],
        ),
    )
    task = asyncio.create_task(job_queue.process_one(job.job_id))
    _track_background_task(task)
    return {"status": "queued", "job_id": job.job_id, "edit_id": payload.edit_id}


@app.post("/transcript/chunks")
async def dispatch_transcript_chunk(payload: TranscriptChunkDispatchRequest):
    """Accept upstream router output and enqueue one ordered job per affected idea.

    The recognition model remains independent: it supplies `matches` with the
    stable idea ID, new/existing flag, and only the relevant excerpt.
    """
    jobs = []
    try:
        for match in payload.matches:
            jobs.append(
                await job_queue.enqueue(
                    chunk_id=payload.chunk_id,
                    source_transcript=payload.transcript,
                    match=match,
                )
            )
        if payload.process_now:
            jobs = await job_queue.process_jobs(job.job_id for job in jobs)
        return {
            "chunk_id": payload.chunk_id,
            "status": "processed" if payload.process_now else "queued",
            "jobs": [job.model_dump() for job in jobs],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/transcript/classified-chunks")
async def dispatch_classified_chunks(payload: ClassifiedChunksRequest):
    """Accept the `classified-chunks.json` shape and enqueue each chunk/idea pair."""
    queued_jobs = []
    chunk_results = []
    try:
        for chunk in payload.chunks:
            clean_chunk = chunk.chunk.strip()
            chunk_id = chunk.chunk_id or hashlib.sha256(
                clean_chunk.encode("utf-8")
            ).hexdigest()[:20]
            # Focus belongs to the conversation, independent of slow enrichment
            # jobs (or whether context extraction finds anything new to add).
            focused_id = next((reference.id for reference in reversed(chunk.ideas)
                               if reference.is_currently_discussed), None)
            await storage.set_discussion_focus(chunk.session_id, focused_id)
            prepared = await asyncio.gather(*(
                orchestrator.prepare_classified_match(
                    idea_id=reference.id,
                    title=reference.title,
                    transcript_chunk=clean_chunk,
                    short_summary=reference.short_summary,
                    session_id=chunk.session_id,
                )
                for reference in chunk.ideas
            ))
            chunk_job_ids = []
            ignored_ideas = []
            for reference, match in zip(chunk.ideas, prepared):
                if match is None:
                    ignored_ideas.append(reference.id)
                    continue
                match.session_id = chunk.session_id
                job = await job_queue.enqueue(
                    chunk_id=chunk_id,
                    source_transcript=clean_chunk,
                    match=match,
                )
                queued_jobs.append(job)
                chunk_job_ids.append(job.job_id)
            chunk_results.append({
                "chunk_id": chunk_id,
                "idea_ids": [reference.id for reference in chunk.ideas],
                "job_ids": chunk_job_ids,
                "ignored_idea_ids": ignored_ideas,
                "has_been_processed": False,
            })

        if payload.process_now and queued_jobs:
            queued_jobs = await job_queue.process_jobs(job.job_id for job in queued_jobs)
            completed = {job.chunk_id for job in queued_jobs if job.status in {"completed", "skipped"}}
            for result in chunk_results:
                result["has_been_processed"] = result["chunk_id"] in completed

        return {
            "status": "processed" if payload.process_now else "queued",
            "chunks": chunk_results,
            "jobs": [job.model_dump() for job in queued_jobs],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/enrichment/queue/jobs")
async def list_enrichment_jobs(status: Optional[str] = None):
    allowed = {"queued", "running", "completed", "failed", "skipped"}
    if status and status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown status '{status}'. Supported: {', '.join(sorted(allowed))}",
        )
    jobs = await job_queue.list(status=status)
    return {"count": len(jobs), "jobs": [job.model_dump() for job in jobs]}


@app.get("/enrichment/queue/jobs/{job_id}")
async def get_enrichment_job(job_id: str):
    job = await job_queue.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return job.model_dump()


@app.post("/enrichment/queue/jobs/{job_id}/run")
async def run_enrichment_job(job_id: str):
    try:
        job = await job_queue.process_one(job_id)
        return job.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/enrichment/queue/drain")
async def drain_enrichment_queue(wait: bool = True):
    """Run queued jobs FIFO per idea and concurrently across different ideas."""
    queued = await job_queue.list(status="queued")
    job_ids = [job.job_id for job in queued]
    if not job_ids:
        return {"status": "empty", "job_ids": []}
    if not wait:
        task = asyncio.create_task(job_queue.process_jobs(job_ids))
        _track_background_task(task)
        return {"status": "dispatched", "job_ids": job_ids}
    jobs = await job_queue.process_jobs(job_ids)
    return {
        "status": "completed",
        "jobs": [job.model_dump() for job in jobs],
    }


@app.post("/ideas/{identifier}/enrich")
async def enrich_selected_idea(
    identifier: str,
    payload: Optional[TranscriptEnrichRequest] = None,
):
    """Enrich one idea from its stored messy multi-person transcript."""
    try:
        return await orchestrator.enrich_idea_from_transcript(
            identifier=identifier,
            transcript_override=payload.transcript if payload else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"{type(exc).__name__}: {str(exc)[:500]}",
        )


@app.post("/ideas/{identifier}/enrich/{service}")
async def enrich_selected_idea_with_service(
    identifier: str,
    service: str,
    payload: Optional[TranscriptEnrichRequest] = None,
):
    """Run one synchronous enrichment stage and persist its result."""
    try:
        return await orchestrator.enrich_one(
            identifier=identifier,
            service=service,
            transcript_override=payload.transcript if payload else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"{type(exc).__name__}: {str(exc)[:500]}",
        )


@app.post("/enrich/auto")
async def auto_enrich(req: AutoEnrichRequest):
    """Automatically triage context delta from speech transcriber and call agents if needed."""
    identifier = req.idea_id or req.title
    if not identifier:
        raise HTTPException(status_code=400, detail="Must provide idea_id or title.")
    try:
        result = await orchestrator.auto_evaluate_and_dispatch(
            identifier=identifier,
            context_delta=req.context,
            run_in_background=True
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/enrich/manual")
async def manual_enrich(req: ManualEnrichRequest):
    """Enable the user to explicitly call a service (competitors, workflow, pros_cons, or all)."""
    identifier = req.idea_id or req.title
    if not identifier:
        raise HTTPException(status_code=400, detail="Must provide idea_id or title.")
    try:
        result = await orchestrator.manual_dispatch(
            identifier=identifier,
            service=req.service,
            context=req.context,
            run_in_background=True
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        while True:
            # Keep alive; client can send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_websockets:
            active_websockets.remove(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.enrichment.main:app", host=SERVER_HOST, port=SERVER_PORT, reload=True)
