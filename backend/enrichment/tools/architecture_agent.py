from typing import Optional

from ..llm_client import llm_client
from ..models import (
    ArchitectureEdge,
    ArchitectureEnrichment,
    ArchitectureNode,
    Idea,
)


class ArchitectureAgent:
    """Create a component-level system architecture distinct from user workflow."""

    async def run(self, idea: Idea, context: Optional[str] = None) -> ArchitectureEnrichment:
        prompt = f"""
IDEA TITLE: {idea.title}
IDEA SUMMARY: {idea.summary}
RELEVANT TRANSCRIPT CONTEXT:
{context or idea.raw_body or 'No context supplied.'}

Design the proposed system architecture. Show concrete components, storage,
queues, model/API calls, human approval boundaries, and important data flows.
Do not produce the user workflow; describe the technical system topology.
Keep the overview and each component responsibility to one short sentence.
Use short node and connection labels so the diagram remains readable.

Return pure JSON:
{{
  "summary": "Architecture overview",
  "nodes": [
    {{
      "id": "short_unique_id",
      "label": "Readable component name",
      "description": "Responsibility",
      "component_type": "client|api|queue|worker|database|model|external|security"
    }}
  ],
  "edges": [
    {{"source": "node_id", "target": "node_id", "label": "Data or action"}}
  ],
  "mermaid_code": "flowchart LR\\n  A[Client] --> B[API]",
  "image_prompt": "Optional visual rendering prompt"
}}
"""
        raw = await llm_client.generate_json(
            prompt=prompt,
            system_instruction=(
                "You are a system architecture diagram agent. Produce a precise, "
                "implementation-oriented component graph and valid Mermaid. Always return JSON."
            ),
        )
        mermaid = str(raw.get("mermaid_code", "")).strip()
        if mermaid.startswith("```"):
            mermaid = "\n".join(
                line for line in mermaid.splitlines() if not line.startswith("```")
            ).strip()
        return ArchitectureEnrichment(
            summary=str(raw.get("summary", "")).strip(),
            nodes=[ArchitectureNode(**node) for node in raw.get("nodes", []) if isinstance(node, dict)],
            edges=[ArchitectureEdge(**edge) for edge in raw.get("edges", []) if isinstance(edge, dict)],
            mermaid_code=mermaid,
            image_prompt=str(raw.get("image_prompt", "")).strip(),
        )


architecture_agent = ArchitectureAgent()
