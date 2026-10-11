from typing import Optional
from ..models import Idea, WorkflowEnrichment
from ..llm_client import llm_client
from ..config import GEMINI_FAST_MODEL


class WorkflowAgent:
    """Subagent responsible for designing operational workflows,

    generating Mermaid diagrams, and creating visual/image prompts.
    """

    async def run(self, idea: Idea, context: Optional[str] = None) -> WorkflowEnrichment:
        print(f"[WorkflowAgent] Running for idea: '{idea.title}'")

        prompt = f"""
You are a Systems Architect and Visual Workflow AI Agent for a brainstorming session.

IDEA DETAILS:
- Title: {idea.title}
- Summary: {idea.summary}

TRANSCRIPT / DISCUSSION CONTEXT:
{context or 'No additional transcript context provided.'}

TASK:
Keep the overview to one short sentence and each step to a short, concrete
action. Avoid repeating the same explanation in the overview and steps.
1. Break down how this idea operates into clear, sequential workflow steps.
2. Generate clean, valid Mermaid.js flowchart syntax (using `graph TD` or `flowchart LR`) illustrating the pipeline/architecture.
3. Write a vivid visual description / image generation prompt that can be passed to an image generation model (e.g., Imagen, DALL-E) to produce a conceptual thumbnail/diagram for this idea.

Return your response in pure JSON format matching this schema:
{{
  "summary": "High-level explanation of how the system/workflow operates",
  "steps": [
    "Step 1: Input ...",
    "Step 2: Processing ...",
    "Step 3: Output ..."
  ],
  "mermaid_code": "graph TD\\n    A[User Action] --> B[Processing Engine]\\n    B --> C[Result Display]",
  "image_prompt": "A modern isometric 3D architectural illustration depicting ... with sleek glowing elements"
}}
"""

        system_instruction = "You are a senior software architect specializing in visual workflows and Mermaid diagrams. Always respond in valid JSON with syntax-valid Mermaid code."

        raw_output = await llm_client.generate_json(
            prompt=prompt,
            system_instruction=system_instruction,
            model=GEMINI_FAST_MODEL,
        )

        steps = [str(s) for s in raw_output.get("steps", []) if s]
        mermaid_code = raw_output.get("mermaid_code", "").strip()
        
        # Clean mermaid code if enclosed in markdown backticks
        if mermaid_code.startswith("```"):
            lines = [l for l in mermaid_code.split("\n") if not l.startswith("```")]
            mermaid_code = "\n".join(lines).strip()

        enrichment = WorkflowEnrichment(
            summary=raw_output.get("summary", ""),
            steps=steps,
            mermaid_code=mermaid_code,
            image_prompt=raw_output.get("image_prompt", ""),
            image_url=None  # Can be populated if integrated with an image generator microservice
        )

        print(f"[WorkflowAgent] Completed workflow for '{idea.title}' with {len(steps)} steps.")
        return enrichment


workflow_agent = WorkflowAgent()
