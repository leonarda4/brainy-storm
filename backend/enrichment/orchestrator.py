import asyncio
import hashlib
import time
from typing import Optional, List, Callable, Dict, Any
from .models import Idea, RoutedIdeaMatch, ToolDecision
from .storage import storage
from .router import decision_router
from .tools.competitor_agent import competitor_agent
from .tools.workflow_agent import workflow_agent
from .tools.pros_cons_agent import pros_cons_agent
from .tools.summary_agent import summary_agent
from .tools.context_agent import context_agent
from .tools.architecture_agent import architecture_agent


class AgenticOrchestrator:
    """Coordinates asynchronous agentic tool execution, state updates,

    and atomic persistence for brainstorming ideas.
    """

    def __init__(self):
        self._listeners: List[Callable[[Dict[str, Any]], Any]] = []

    def subscribe(self, listener: Callable[[Dict[str, Any]], Any]):
        """Register a callback for real-time lifecycle updates (e.g. WebSockets)."""
        self._listeners.append(listener)

    async def _emit_event(self, event_type: str, data: Dict[str, Any]):
        for listener in self._listeners:
            try:
                res = listener({"event": event_type, "timestamp": time.time(), "data": data})
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                print(f"[Orchestrator] Error notifying listener: {e}")

    async def auto_evaluate_and_dispatch(
        self,
        identifier: str,
        context_delta: str,
        run_in_background: bool = True
    ) -> Dict[str, Any]:
        """Automatically evaluates whether new speech context warrants tool execution,

        and dispatches required agents.
        """
        idea = await storage.get_idea(identifier)
        if not idea:
            raise ValueError(f"Idea not found: '{identifier}'")

        # The idea record is the durable source of truth for the continuously
        # arriving transcript. Preserve each delta before dispatch decisions.
        clean_delta = context_delta.strip()
        if clean_delta:
            idea.transcript = "\n".join(filter(None, [idea.transcript, clean_delta]))
            idea.updated_at = time.time()
            await storage.save_or_update_idea(idea)

        # 1. Triage decision
        decision: ToolDecision = await decision_router.evaluate_context_delta(idea, context_delta)

        # Apply immediate delta updates if found (e.g. summary nuance, quick proponent/opponent notes)
        if decision.summary_refinement:
            idea.summary = decision.summary_refinement
        if decision.new_proponents:
            idea.proponents = list(dict.fromkeys(idea.proponents + decision.new_proponents))
        if decision.new_opponents:
            idea.opponents = list(dict.fromkeys(idea.opponents + decision.new_opponents))

        tools_to_run = []
        if decision.call_competitors:
            tools_to_run.append("competitors")
        if decision.call_workflow:
            tools_to_run.append("workflow")
        if decision.call_pros_cons:
            tools_to_run.append("pros_cons")

        if not tools_to_run:
            idea.updated_at = time.time()
            await storage.save_or_update_idea(idea)
            return {
                "idea_id": idea.id,
                "triggered": False,
                "message": "No agentic tools required for this context delta.",
                "tools": []
            }

        # Dispatch selected tools
        if run_in_background:
            asyncio.create_task(self._run_tool_pipeline(idea.id, tools_to_run, context_delta))
            return {
                "idea_id": idea.id,
                "triggered": True,
                "dispatched_tools": tools_to_run,
                "decision": decision.model_dump()
            }
        else:
            await self._run_tool_pipeline(idea.id, tools_to_run, context_delta)
            updated_idea = await storage.get_idea(idea.id)
            return {
                "idea_id": idea.id,
                "triggered": True,
                "dispatched_tools": tools_to_run,
                "idea": updated_idea.model_dump() if updated_idea else None
            }

    async def manual_dispatch(
        self,
        identifier: str,
        service: str,
        context: Optional[str] = None,
        run_in_background: bool = True
    ) -> Dict[str, Any]:
        """Enables the user to explicitly invoke a specific tool or 'all' services."""
        idea = await storage.get_idea(identifier)
        if not idea:
            raise ValueError(f"Idea not found: '{identifier}'")

        service_clean = service.lower().strip()
        if service_clean == "all":
            if run_in_background:
                asyncio.create_task(self.enrich_idea_from_transcript(idea.id, context))
                return {
                    "idea_id": idea.id,
                    "status": "enriching",
                    "dispatched_tools": ["summary", "pros_cons", "workflow", "architecture", "competitors"],
                    "mode": "manual",
                }
            return await self.enrich_idea_from_transcript(idea.id, context)
        elif service_clean in ["competitors", "workflow", "architecture", "pros_cons"]:
            tools_to_run = [service_clean]
        else:
            raise ValueError(f"Unknown service: '{service}'. Supported: competitors, workflow, architecture, pros_cons, all")

        full_context = context or idea.transcript or await storage.get_transcript()

        if run_in_background:
            asyncio.create_task(self._run_tool_pipeline(idea.id, tools_to_run, full_context))
            return {
                "idea_id": idea.id,
                "status": "enriching",
                "dispatched_tools": tools_to_run,
                "mode": "manual"
            }
        else:
            await self._run_tool_pipeline(idea.id, tools_to_run, full_context)
            updated_idea = await storage.get_idea(idea.id)
            return {
                "idea_id": idea.id,
                "status": "enriched",
                "dispatched_tools": tools_to_run,
                "idea": updated_idea.model_dump() if updated_idea else None
            }

    async def enrich_idea_from_transcript(
        self,
        identifier: str,
        transcript_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run the deterministic transcript -> insight -> design/research pipeline.

        Summary must finish first. Pros/cons then receives the complete source
        transcript, while workflow design and competitor discovery receive the
        distilled summary. Results are committed together to avoid subagent
        read/modify/write races in ideas.json.
        """
        idea = await storage.get_idea(identifier)
        if not idea:
            raise ValueError(f"Idea not found: '{identifier}'")

        context = (transcript_override or idea.raw_body or idea.transcript or "").strip()
        if not context:
            raise ValueError(
                f"Idea '{identifier}' has no raw body or transcript. Ingest transcript context first."
            )

        if transcript_override:
            idea.transcript = context
            idea.raw_body = context
        elif not idea.raw_body:
            # Backfill legacy idea records that only had `transcript`.
            idea.raw_body = context
        idea.status = "enriching"
        idea.active_tools = ["summary"]
        idea.updated_at = time.time()
        await storage.save_or_update_idea(idea)
        await self._emit_event("tools_started", {
            "idea_id": idea.id,
            "tools": ["summary", "pros_cons", "workflow", "architecture", "competitors"],
        })

        parallel_tasks: List[asyncio.Task] = []
        try:
            # These transcript-first stages do not depend on the new summary,
            # so start them while summary generation is in flight.
            pros_task = asyncio.create_task(pros_cons_agent.run(idea, context))
            architecture_task = asyncio.create_task(architecture_agent.run(idea, context))
            parallel_tasks.extend([pros_task, architecture_task])

            summary, key_takeaway = await summary_agent.run(idea, context)
            idea.summary = summary
            idea.metadata["key_takeaway"] = key_takeaway
            idea.active_tools = ["pros_cons", "workflow", "architecture", "competitors"]

            # Workflow and competitor research use the concise summary and can
            # start immediately once that dependency is ready.
            workflow_task = asyncio.create_task(workflow_agent.run(idea, summary))
            competitor_task = asyncio.create_task(competitor_agent.run(idea, summary))
            parallel_tasks.extend([workflow_task, competitor_task])
            results = await asyncio.gather(
                pros_task, workflow_task, architecture_task, competitor_task, return_exceptions=True
            )

            execution = {"summary": {"status": "success"}}
            failures = []

            pros_result, workflow_result, architecture_result, competitor_result = results
            if isinstance(pros_result, BaseException):
                failures.append("pros_cons")
                execution["pros_cons"] = {"status": "failed", "error": str(pros_result)}
            else:
                idea.pros_cons, idea.proponents, idea.opponents = pros_result
                execution["pros_cons"] = {"status": "success"}

            if isinstance(workflow_result, BaseException):
                failures.append("workflow")
                execution["workflow"] = {"status": "failed", "error": str(workflow_result)}
            else:
                idea.workflow = workflow_result
                execution["workflow"] = {"status": "success"}

            if isinstance(architecture_result, BaseException):
                failures.append("architecture")
                execution["architecture"] = {"status": "failed", "error": str(architecture_result)}
            else:
                idea.systemGraph = architecture_result
                execution["architecture"] = {"status": "success"}

            if isinstance(competitor_result, BaseException):
                failures.append("competitors")
                execution["competitors"] = {"status": "failed", "error": str(competitor_result)}
            else:
                idea.competitors = competitor_result
                execution["competitors"] = {"status": "success"}

            idea.status = "error" if failures else "enriched"
            idea.active_tools = []
            idea.updated_at = time.time()
            if failures:
                idea.metadata["enrichment_failures"] = failures
            else:
                idea.metadata.pop("enrichment_failures", None)
            await storage.save_or_update_idea(idea)
            await self._emit_event("idea_updated", {"idea": idea.model_dump()})
            return {
                "idea_id": idea.id,
                "status": idea.status,
                "execution": execution,
                "idea": idea.model_dump(),
            }
        except Exception:
            for task in parallel_tasks:
                if not task.done():
                    task.cancel()
            if parallel_tasks:
                await asyncio.gather(*parallel_tasks, return_exceptions=True)
            idea.status = "error"
            idea.active_tools = []
            idea.updated_at = time.time()
            await storage.save_or_update_idea(idea)
            raise

    async def enrich_one(
        self,
        identifier: str,
        service: str,
        transcript_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Synchronously run and persist one enrichment stage."""
        service_clean = service.lower().strip().replace("-", "_")
        supported = {"summary", "pros_cons", "workflow", "architecture", "competitors"}
        if service_clean not in supported:
            raise ValueError(
                f"Unknown service '{service}'. Supported: {', '.join(sorted(supported))}"
            )

        idea = await storage.get_idea(identifier)
        if not idea:
            raise ValueError(f"Idea not found: '{identifier}'")

        context = (transcript_override or idea.raw_body or idea.transcript or "").strip()
        if not context:
            raise ValueError(
                f"Idea '{identifier}' has no raw body or transcript. Ingest transcript context first."
            )
        if transcript_override:
            idea.transcript = context
            idea.raw_body = context
        elif not idea.raw_body:
            idea.raw_body = context

        if service_clean in {"workflow", "architecture", "competitors"} and not idea.summary.strip():
            raise ValueError(
                f"Idea '{identifier}' has no summary. Run the summary endpoint first."
            )

        idea.status = "enriching"
        idea.active_tools = [service_clean]
        idea.updated_at = time.time()
        await storage.save_or_update_idea(idea)

        try:
            if service_clean == "summary":
                summary, key_takeaway = await summary_agent.run(idea, context)
                idea.summary = summary
                idea.metadata["key_takeaway"] = key_takeaway
                result: Any = {
                    "summary": summary,
                    "key_takeaway": key_takeaway,
                }
            elif service_clean == "pros_cons":
                enrichment, proponents, opponents = await pros_cons_agent.run(idea, context)
                idea.pros_cons = enrichment
                idea.proponents = proponents
                idea.opponents = opponents
                result = enrichment.model_dump()
            elif service_clean == "workflow":
                enrichment = await workflow_agent.run(idea, idea.summary)
                idea.workflow = enrichment
                result = enrichment.model_dump()
            elif service_clean == "architecture":
                enrichment = await architecture_agent.run(idea, context)
                idea.systemGraph = enrichment
                result = enrichment.model_dump()
            else:
                enrichment = await competitor_agent.run(idea, idea.summary)
                idea.competitors = enrichment
                result = enrichment.model_dump()

            idea.active_tools = []
            idea.status = (
                "enriched"
                if idea.summary and idea.pros_cons and idea.workflow and idea.systemGraph and idea.competitors
                else "idle"
            )
            idea.updated_at = time.time()
            idea.metadata["last_enrichment_service"] = service_clean
            await storage.save_or_update_idea(idea)
            await self._emit_event("tool_completed", {
                "idea_id": idea.id,
                "tool": service_clean,
                "result": result,
            })
            return {
                "idea_id": idea.id,
                "service": service_clean,
                "status": "success",
                "result": result,
            }
        except Exception:
            idea.status = "error"
            idea.active_tools = []
            idea.updated_at = time.time()
            await storage.save_or_update_idea(idea)
            raise

    async def ingest_transcript_delta(
        self,
        identifier: str,
        transcript_delta: str,
        title: Optional[str] = None,
        enrich: bool = True,
    ) -> Dict[str, Any]:
        """Filter a new transcript chunk into an ID-based idea and optionally re-enrich it."""
        clean_delta = transcript_delta.strip()
        if not clean_delta:
            raise ValueError("Transcript delta cannot be empty.")

        idea = await storage.get_idea(identifier)
        is_new = idea is None
        if is_new:
            if not title or not title.strip():
                raise ValueError("A title is required when ingesting a new idea ID.")
            idea = Idea(id=identifier, title=title.strip())
        elif title and title.strip():
            idea.title = title.strip()

        delta_hash = hashlib.sha256(clean_delta.encode("utf-8")).hexdigest()
        seen_hashes = list(idea.metadata.get("ingested_transcript_hashes", []))
        if delta_hash in seen_hashes:
            return {
                "idea_id": idea.id,
                "status": "duplicate",
                "message": "This transcript delta was already ingested.",
            }

        extraction = await context_agent.run(idea, clean_delta)
        idea.transcript = "\n".join(filter(None, [idea.transcript, clean_delta]))
        seen_hashes.append(delta_hash)
        idea.metadata["ingested_transcript_hashes"] = seen_hashes[-100:]
        idea.metadata["last_context_extraction"] = {
            "is_relevant": extraction["is_relevant"],
            "reason": extraction["reason"],
        }

        relevant_body = extraction["relevant_body"].strip()
        if extraction["is_relevant"] and relevant_body:
            if relevant_body not in idea.raw_body:
                idea.raw_body = "\n\n".join(filter(None, [idea.raw_body, relevant_body]))
        idea.updated_at = time.time()
        await storage.save_or_update_idea(idea)

        if not extraction["is_relevant"] or not relevant_body:
            return {
                "idea_id": idea.id,
                "status": "ignored",
                "is_new": is_new,
                "extraction": extraction,
                "raw_body_chars": len(idea.raw_body),
            }

        if not enrich:
            return {
                "idea_id": idea.id,
                "status": "ingested",
                "is_new": is_new,
                "extraction": extraction,
                "raw_body_chars": len(idea.raw_body),
            }

        enrichment = await self.enrich_idea_from_transcript(idea.id)
        enrichment.update({
            "is_new": is_new,
            "extraction": extraction,
            "raw_body_chars": len(idea.raw_body),
        })
        return enrichment

    async def prepare_classified_match(
        self,
        idea_id: str,
        title: str,
        transcript_chunk: str,
        short_summary: Optional[str] = None,
        session_id: str = "Hackathon",
    ) -> Optional[RoutedIdeaMatch]:
        """Turn one classified chunk/idea pair into a minimal enrichment job."""
        idea = await storage.get_idea(idea_id)
        if idea and idea.session_id != session_id:
            raise ValueError("The idea belongs to another storm.")
        is_new = idea is None
        candidate = idea or Idea(id=idea_id, title=title, session_id=session_id)
        extraction = await context_agent.run(candidate, transcript_chunk)
        excerpt = extraction["relevant_body"].strip()
        if not extraction["is_relevant"] or not excerpt:
            return None

        tools = None
        if not is_new:
            decision = await decision_router.evaluate_context_delta(idea, excerpt)
            selected = ["summary"]
            if decision.call_pros_cons:
                selected.append("pros_cons")
            if decision.call_workflow:
                selected.extend(["workflow", "architecture"])
            if decision.call_competitors:
                selected.append("competitors")
            tools = list(dict.fromkeys(selected))

        return RoutedIdeaMatch(
            session_id=session_id,
            idea_id=idea_id,
            is_new=is_new,
            title=title,
            short_summary=short_summary,
            relevant_excerpt=excerpt,
            reason=extraction["reason"],
            tools=tools,
        )

    async def _run_tool_pipeline(self, idea_id: str, tools: List[str], context: Optional[str]):
        """Executes selected tools concurrently and persists updates atomically."""
        idea = await storage.get_idea(idea_id)
        if not idea:
            return

        idea.status = "enriching"
        for t in tools:
            if t not in idea.active_tools:
                idea.active_tools.append(t)
        await storage.save_or_update_idea(idea)
        await self._emit_event("tools_started", {"idea_id": idea_id, "tools": tools})

        tasks = []
        for t in tools:
            if t == "competitors":
                tasks.append(self._run_competitor_subagent(idea_id, context))
            elif t == "workflow":
                tasks.append(self._run_workflow_subagent(idea_id, context))
            elif t == "architecture":
                tasks.append(self._run_architecture_subagent(idea_id, context))
            elif t == "pros_cons":
                tasks.append(self._run_pros_cons_subagent(idea_id, context))

        # Run subagents concurrently
        await asyncio.gather(*tasks, return_exceptions=True)

        # Finalize idea state
        final_idea = await storage.get_idea(idea_id)
        if final_idea:
            final_idea.active_tools = [t for t in final_idea.active_tools if t not in tools]
            if not final_idea.active_tools:
                final_idea.status = "enriched"
            final_idea.updated_at = time.time()
            await storage.save_or_update_idea(final_idea)
            await self._emit_event("idea_updated", {"idea": final_idea.model_dump()})

    async def _run_competitor_subagent(self, idea_id: str, context: Optional[str]):
        try:
            idea = await storage.get_idea(idea_id)
            if not idea:
                return
            result = await competitor_agent.run(idea, context)
            
            # Re-fetch before saving to avoid race conditions with other subagents
            current_idea = await storage.get_idea(idea_id)
            if current_idea:
                current_idea.competitors = result
                current_idea.updated_at = time.time()
                await storage.save_or_update_idea(current_idea)
                await self._emit_event("tool_completed", {"idea_id": idea_id, "tool": "competitors", "result": result.model_dump()})
        except Exception as e:
            print(f"[Orchestrator] Error running competitor agent: {e}")

    async def _run_workflow_subagent(self, idea_id: str, context: Optional[str]):
        try:
            idea = await storage.get_idea(idea_id)
            if not idea:
                return
            result = await workflow_agent.run(idea, context)

            current_idea = await storage.get_idea(idea_id)
            if current_idea:
                current_idea.workflow = result
                # If thumbnail not set, can assign workflow image or placeholder
                if not current_idea.thumbnail and result.image_url:
                    current_idea.thumbnail = result.image_url
                current_idea.updated_at = time.time()
                await storage.save_or_update_idea(current_idea)
                await self._emit_event("tool_completed", {"idea_id": idea_id, "tool": "workflow", "result": result.model_dump()})
        except Exception as e:
            print(f"[Orchestrator] Error running workflow agent: {e}")

    async def _run_architecture_subagent(self, idea_id: str, context: Optional[str]):
        try:
            idea = await storage.get_idea(idea_id)
            if not idea:
                return
            result = await architecture_agent.run(idea, context)
            current_idea = await storage.get_idea(idea_id)
            if current_idea:
                current_idea.systemGraph = result
                current_idea.updated_at = time.time()
                await storage.save_or_update_idea(current_idea)
                await self._emit_event("tool_completed", {
                    "idea_id": idea_id,
                    "tool": "architecture",
                    "result": result.model_dump(),
                })
        except Exception as e:
            print(f"[Orchestrator] Error running architecture agent: {e}")

    async def _run_pros_cons_subagent(self, idea_id: str, context: Optional[str]):
        try:
            idea = await storage.get_idea(idea_id)
            if not idea:
                return
            result, updated_proponents, updated_opponents = await pros_cons_agent.run(idea, context)

            current_idea = await storage.get_idea(idea_id)
            if current_idea:
                current_idea.pros_cons = result
                current_idea.proponents = updated_proponents
                current_idea.opponents = updated_opponents
                current_idea.updated_at = time.time()
                await storage.save_or_update_idea(current_idea)
                await self._emit_event("tool_completed", {
                    "idea_id": idea_id,
                    "tool": "pros_cons",
                    "result": result.model_dump(),
                    "proponents": updated_proponents,
                    "opponents": updated_opponents
                })
        except Exception as e:
            print(f"[Orchestrator] Error running pros/cons agent: {e}")


orchestrator = AgenticOrchestrator()
