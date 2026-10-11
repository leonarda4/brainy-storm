from typing import Any, Dict

from ..llm_client import llm_client
from ..models import Idea
from ..config import GEMINI_FAST_MODEL


class IdeaContextAgent:
    """Extract only the new transcript material relevant to one idea."""

    async def run(self, idea: Idea, transcript_delta: str) -> Dict[str, Any]:
        prompt = f"""
IDEA ID: {idea.id}
IDEA TITLE: {idea.title}
CURRENT SUMMARY: {idea.summary or 'Not generated yet'}
CURRENT IDEA RAW BODY:
{idea.raw_body or 'Empty'}

NEW TRANSCRIPT DELTA START
{transcript_delta}
NEW TRANSCRIPT DELTA END

Extract only statements that discuss this idea: its problem, users, proposed
solution, requirements, design, workflow, evidence, advantages, objections,
risks, decisions, competitors, or next steps. Preserve speaker names and the
meaning of their statements. Exclude greetings, unrelated ideas, and small talk.
Do not summarize; return clean source material suitable as cumulative context.

Return pure JSON:
{{
  "is_relevant": true,
  "relevant_body": "Speaker-attributed relevant transcript excerpts",
  "reason": "Short explanation"
}}
"""
        raw = await llm_client.generate_json(
            prompt=prompt,
            system_instruction=(
                "You are an idea transcript relevance extractor. "
                "You filter new multi-person transcript chunks for one identified idea. "
                "Always return valid JSON."
            ),
            model=GEMINI_FAST_MODEL,
        )
        body = str(raw.get("relevant_body", "")).strip()
        return {
            "is_relevant": bool(raw.get("is_relevant", bool(body))),
            "relevant_body": body,
            "reason": str(raw.get("reason", "")).strip(),
        }


context_agent = IdeaContextAgent()
