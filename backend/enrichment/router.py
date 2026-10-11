from typing import Optional
from .models import Idea, ToolDecision
from .llm_client import llm_client
from .config import GEMINI_FAST_MODEL
from .stance_participants import clean_participant_attributions


class DecisionRouter:
    """Triage agent that analyzes newly transcribed context to determine

    if and which specialized agentic tools need to be called.
    """

    async def evaluate_context_delta(self, idea: Idea, context_delta: str) -> ToolDecision:
        print(f"[DecisionRouter] Evaluating context delta ({len(context_delta)} chars) for idea: '{idea.title}'")

        # Quick check: If the idea has never been enriched at all, we should trigger enrichments
        is_fresh_idea = (
            idea.competitors is None or
            idea.workflow is None or
            idea.pros_cons is None
        )

        prompt = f"""
You are the Agentic Triage Router for a real-time brainstorming assistant.
Your job is to listen to newly spoken context and decide which background AI tools need to be executed.

CURRENT IDEA STATE:
- Title: {idea.title}
- Summary: {idea.summary}
- Has Competitor Analysis: {'Yes' if idea.competitors else 'No'}
- Has Workflow Diagram: {'Yes' if idea.workflow else 'No'}
- Has Pros/Cons Analysis: {'Yes' if idea.pros_cons else 'No'}
- Current Proponents: {', '.join(idea.proponents) if idea.proponents else 'None'}
- Current Opponents: {', '.join(idea.opponents) if idea.opponents else 'None'}

NEWLY TRANSCRIBED DISCUSSION CONTEXT:
"{context_delta}"

AVAILABLE TOOLS TO CALL:
1. `competitor_agent`: Call if the context mentions competitors, market players, business model, pricing, or if the idea lacks initial competitor analysis.
2. `workflow_agent`: Call if the context describes how the system/solution works, steps, architecture, tech stack, or if the idea lacks an initial visual workflow diagram.
3. `pros_cons_agent`: Call if participants express support, skepticism, objections, trade-offs, feasibility questions, or if the idea lacks pros/cons.

DECISION CRITERIA:
- Do not trigger tools unnecessarily if the new context is just casual small-talk or irrelevant.
- If the new context provides meaningful new perspectives or if the idea is fresh and missing enrichments, set the respective tool flags to true.
- Proponents and opponents must be actual named participants or numbered speakers
  explicitly expressing support or opposition in the transcript, never arguments
  or invented personas. Return [] when there are none. Do not infer opposition
  from questions or preferences, or use placeholders such as "Minimalist opposition".

Return your response in pure JSON format matching this schema:
{{
  "call_competitors": true/false,
  "competitor_reason": "Explanation if true, or null",
  "call_workflow": true/false,
  "workflow_reason": "Explanation if true, or null",
  "call_pros_cons": true/false,
  "pros_cons_reason": "Explanation if true, or null",
  "summary_refinement": "Refined summary if context significantly altered the core idea, otherwise null",
  "new_proponents": [],
  "new_opponents": []
}}
"""

        system_instruction = "You are an intelligent agent dispatcher. You determine with surgical precision which subagent tools need to be invoked based on conversational transcripts. Always respond in valid JSON."

        raw_output = await llm_client.generate_json(
            prompt=prompt,
            system_instruction=system_instruction,
            model=GEMINI_FAST_MODEL,
        )

        decision = ToolDecision(
            call_competitors=bool(raw_output.get("call_competitors", False)),
            competitor_reason=raw_output.get("competitor_reason"),
            call_workflow=bool(raw_output.get("call_workflow", False)),
            workflow_reason=raw_output.get("workflow_reason"),
            call_pros_cons=bool(raw_output.get("call_pros_cons", False)),
            pros_cons_reason=raw_output.get("pros_cons_reason"),
            summary_refinement=raw_output.get("summary_refinement"),
            new_proponents=clean_participant_attributions(raw_output.get("new_proponents", [])),
            new_opponents=clean_participant_attributions(raw_output.get("new_opponents", []))
        )

        # If it's a completely fresh idea without enrichments, ensure we don't skip initial enrichment
        if is_fresh_idea:
            if not idea.competitors:
                decision.call_competitors = True
                decision.competitor_reason = decision.competitor_reason or "Initial competitor analysis for new idea"
            if not idea.workflow:
                decision.call_workflow = True
                decision.workflow_reason = decision.workflow_reason or "Initial workflow diagram for new idea"
            if not idea.pros_cons:
                decision.call_pros_cons = True
                decision.pros_cons_reason = decision.pros_cons_reason or "Initial pros/cons analysis for new idea"

        print(
            f"[DecisionRouter] Decision for '{idea.title}': "
            f"competitors={decision.call_competitors}, workflow={decision.call_workflow}, pros_cons={decision.call_pros_cons}"
        )
        return decision


decision_router = DecisionRouter()
