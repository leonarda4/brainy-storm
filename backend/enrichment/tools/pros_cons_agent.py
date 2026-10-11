from typing import Optional, Tuple, List
from ..models import Idea, ProConItem, ProsConsEnrichment
from ..llm_client import llm_client
from ..stance_participants import clean_participant_attributions


class ProsConsAgent:
    """Subagent responsible for critical analysis, extracting pros and cons,

    identifying risks, and categorizing proponents and opponents from discussions.
    """

    async def run(self, idea: Idea, context: Optional[str] = None) -> Tuple[ProsConsEnrichment, List[str], List[str]]:
        print(f"[ProsConsAgent] Running for idea: '{idea.title}'")

        prompt = f"""
You are a Critical Debate & Evaluation AI Agent for a brainstorming session.

IDEA DETAILS:
- Title: {idea.title}
- Summary: {idea.summary}
- Existing Proponents: {', '.join(idea.proponents) if idea.proponents else 'None'}
- Existing Opponents: {', '.join(idea.opponents) if idea.opponents else 'None'}

TRANSCRIPT / DISCUSSION CONTEXT:
{context or 'No additional transcript context provided.'}

TASK:
1. Extract every material PRO and CON from the discussion and explicit user
   written contributions. Written additions are context even if never spoken;
   attribute them to written input, never invent a speaker or spoken quote.
2. Categorize each as Technical, Business & Market, User Experience,
   Operations, Compliance & Security, or Financial.
3. Rate each point High, Medium, or Low and sort highest impact/risk first.
4. Include a short speaker-attributed source quote or close paraphrase.
5. Identify additional key risks, assumptions and open questions that still
   require validation. Avoid repeating cons as key risks. Do not present an
   inferred assumption or question as something a participant actually said.
6. Proponents and opponents are actual participants, never arguments, personas,
   groups, or descriptions of sentiment. Return only names or numbered speaker
   labels explicitly present in the transcript and explicitly expressing that
   stance. Do not infer opposition from a question or a preference for simplicity.
   If nobody explicitly supports or opposes the idea, return [] for that list.
   Never create placeholders such as "Minimalist opposition", "None", or
   "Technical skeptics". Put concerns in cons, not in the participant lists.
7. Keep the synthesis to one short sentence. Use one concise sentence per
   point (aim for 20 words), risk, assumption or question. Merge duplicates
   while retaining material details and qualifications.

Return your response in pure JSON format matching this schema:
{{
  "summary": "Overall synthesis of the debate and any conditional consensus",
  "pros": [{{
    "point": "Specific benefit",
    "category": "Operations",
    "severity_or_impact": "High",
    "source_context": "Sarah said ..."
  }}],
  "cons": [{{
    "point": "Specific objection or risk",
    "category": "Compliance & Security",
    "severity_or_impact": "High",
    "source_context": "Elena warned ..."
  }}],
  "key_risks": ["Risk 1...", "Risk 2..."],
  "assumptions": ["Assumption that needs validation"],
  "open_questions": ["Question 1...", "Question 2..."],
  "proponents": [],
  "opponents": []
}}
"""

        system_instruction = "You are a pragmatic, analytical product evaluator. You cut through hype to find real pros, cons, and risks. Always respond in valid JSON."

        raw_output = await llm_client.generate_json(
            prompt=prompt,
            system_instruction=system_instruction
        )

        def parse_items(items):
            parsed = []
            for item in items if isinstance(items, list) else []:
                if isinstance(item, str):
                    parsed.append(ProConItem(point=item))
                elif isinstance(item, dict) and item.get("point"):
                    severity = str(
                        item.get("severity_or_impact")
                        or item.get("severityOrImpact")
                        or "Medium"
                    ).title()
                    if severity not in {"High", "Medium", "Low"}:
                        severity = "Medium"
                    parsed.append(ProConItem(
                        point=str(item["point"]),
                        category=str(item.get("category") or "General"),
                        severity_or_impact=severity,
                        source_context=str(
                            item.get("source_context")
                            or item.get("sourceContext")
                            or ""
                        ),
                    ))
            priority = {"High": 3, "Medium": 2, "Low": 1}
            return sorted(
                parsed,
                key=lambda value: priority.get(value.severity_or_impact, 0),
                reverse=True,
            )

        enrichment = ProsConsEnrichment(
            summary=str(raw_output.get("summary") or "").strip() or None,
            pros=parse_items(raw_output.get("pros", [])),
            cons=parse_items(raw_output.get("cons", [])),
            key_risks=[str(r) for r in raw_output.get("key_risks", []) if r],
            assumptions=[str(a) for a in raw_output.get("assumptions", []) if a],
            open_questions=[str(q) for q in raw_output.get("open_questions", []) if q]
        )

        # Merge new proponents/opponents preserving existing unique entries
        new_proponents = clean_participant_attributions(idea.proponents + clean_participant_attributions(raw_output.get("proponents", [])))
        new_opponents = clean_participant_attributions(idea.opponents + clean_participant_attributions(raw_output.get("opponents", [])))

        print(f"[ProsConsAgent] Completed for '{idea.title}' with {len(enrichment.pros)} pros, {len(enrichment.cons)} cons.")
        return enrichment, new_proponents, new_opponents


pros_cons_agent = ProsConsAgent()
