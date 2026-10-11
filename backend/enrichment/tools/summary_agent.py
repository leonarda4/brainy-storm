from typing import Optional, Tuple

from ..llm_client import llm_client
from ..models import Idea
from ..config import GEMINI_FAST_MODEL


class SummaryAgent:
    """Turns a noisy multi-speaker transcript into an idea-level summary."""

    async def run(self, idea: Idea, transcript: Optional[str] = None) -> Tuple[str, str]:
        source = (transcript or idea.transcript or "").strip()
        if not source:
            raise ValueError(f"Idea '{idea.id}' has no transcript to summarize.")

        prompt = f"""
IDEA TITLE: {idea.title}

DISCUSSION AND USER WRITTEN CONTRIBUTIONS:
{source}

Create a factual, concise summary of this specific idea. Separate what the
idea is from unresolved discussion. Do not invent consensus or features.
Treat explicit written contributions as additional context, including details
not spoken aloud. Later written corrections supersede earlier descriptions.
Keep the summary to 2 short sentences and the takeaway to one short sentence.

Return pure JSON:
{{
  "summary": "A 2-sentence idea summary covering the user, problem, solution, and operation.",
  "key_takeaway": "The most important decision or unresolved next step."
}}
"""
        raw = await llm_client.generate_json(
            prompt=prompt,
            system_instruction=(
                "You synthesize noisy, multi-speaker product transcripts into precise idea briefs. "
                "Always return valid JSON."
            ),
            model=GEMINI_FAST_MODEL,
        )

        summary = str(raw.get("summary", "")).strip()
        takeaway = str(raw.get("key_takeaway", raw.get("keyTakeaway", ""))).strip()
        if not summary:
            # Smart-mock mode is intentionally useful without API keys, but its
            # generic response is not a summary. Keep the offline path honest.
            compact = " ".join(source.split())
            summary = compact[:500] + ("..." if len(compact) > 500 else "")
        return summary, takeaway


summary_agent = SummaryAgent()
