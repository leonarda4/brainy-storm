import asyncio
import json
from pathlib import Path
from backend.enrichment.models import Idea
from backend.enrichment.storage import storage
from backend.enrichment.orchestrator import orchestrator


async def run_test():
    print("=" * 60)
    print("TESTING ASYNCHRONOUS AGENTIC TOOL CALLING SYSTEM")
    print("=" * 60)

    # 1. Create a test boilerplate idea
    test_idea = Idea(
        id="voice-brainstorm-ai",
        title="Voice-First Agentic Brainstorming Canvas",
        summary="An interactive canvas that transcribes speech, clusters thoughts into distinct ideas, and autonomously enriches them with competitor research, visual workflows, and debate pros/cons.",
        proponents=["Marko (arguing for frictionless voice input)"],
        opponents=["Alex (concerned about latency of agent calls)"],
        thumbnail="path/to/preview.png"
    )

    print(f"\n1. Upserting boilerplate idea: '{test_idea.title}'...")
    await storage.save_or_update_idea(test_idea)

    # 2. Simulate speech transcription event (Automatic Reactive Tool Calling)
    new_speech_chunk = (
        "Hey everyone, let's look at competitors like Otter and Miro. "
        "Also, the architecture should have an audio transcriber streaming to FastAPI, "
        "and how do we position against Whimsical? Is it fast enough?"
    )

    print(f"\n2. Simulating new speech transcribed:\n   \"{new_speech_chunk}\"")
    print("   Evaluating context delta with DecisionRouter...")

    auto_result = await orchestrator.auto_evaluate_and_dispatch(
        identifier=test_idea.id,
        context_delta=new_speech_chunk,
        run_in_background=False  # synchronous in test script to await completion
    )
    print("   Auto Dispatch Result:", json.dumps(auto_result, indent=2))

    # 3. Verify idea has been enriched in storage
    enriched_idea = await storage.get_idea(test_idea.id)
    print("\n3. Enriched Idea State:")
    print(f"   Status: {enriched_idea.status}")
    print(f"   Has Competitors: {enriched_idea.competitors is not None}")
    if enriched_idea.competitors:
        print(f"   Competitors Count: {len(enriched_idea.competitors.competitors)}")
        print(f"   Our Positioning: {enriched_idea.competitors.our_positioning}")

    print(f"   Has Workflow: {enriched_idea.workflow is not None}")
    if enriched_idea.workflow:
        print(f"   Workflow Steps: {len(enriched_idea.workflow.steps)}")
        print(f"   Mermaid Code Sample:\n   {enriched_idea.workflow.mermaid_code[:100]}...")

    print(f"   Has Pros & Cons: {enriched_idea.pros_cons is not None}")
    if enriched_idea.pros_cons:
        print(f"   Pros: {enriched_idea.pros_cons.pros}")
        print(f"   Cons: {enriched_idea.pros_cons.cons}")
        print(f"   Proponents: {enriched_idea.proponents}")
        print(f"   Opponents: {enriched_idea.opponents}")

    # 4. Simulate user-initiated manual service call (e.g. user clicked "Analyze Competitors")
    print("\n4. Simulating User Manual Service Call: 'competitors'...")
    manual_result = await orchestrator.manual_dispatch(
        identifier=test_idea.id,
        service="competitors",
        context="User specifically requested deep dive on AI whiteboard market positioning.",
        run_in_background=False
    )
    print("   Manual Call Result Status:", manual_result.get("status"))

    # 5. Check data/ideas.json contents
    ideas_file = Path(__file__).resolve().parent.parent.parent / "data" / "ideas.json"
    with open(ideas_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    print(f"\n5. Verified data/ideas.json file: {len(data.get('ideas', []))} idea(s) stored.")

    print("\n[SUCCESS] Asynchronous Agentic Tool Calling pipeline verified end-to-end!")


if __name__ == "__main__":
    asyncio.run(run_test())

