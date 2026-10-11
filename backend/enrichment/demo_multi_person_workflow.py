"""Multi-Person Brainstorming Workflow Demonstration.

Demonstrates real-time ingestion of speech turns from a multi-speaker debate,
evaluating context deltas via the Decision Router, dispatching asynchronous
subagents (Competitors, Workflow/Diagram, Pros/Cons), and persisting state
atomically to `data/ideas.json`.

Usage:
    python -m backend.enrichment.demo_multi_person_workflow
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Dict, Any

from .config import IDEAS_FILE, TRANSCRIPT_FILE
from .models import Idea
from .storage import storage
from .orchestrator import orchestrator


CONVERSATION_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "example_multi_person_session.json"


def print_banner(text: str, char: str = "="):
    print("\n" + char * 70)
    print(f" {text}")
    print(char * 70)


def print_turn_header(turn_num: int, speaker: str):
    print(f"\n[Turn {turn_num}] Speaker: \033[1;36m{speaker}\033[0m")


async def run_multi_person_demo():
    print_banner("MULTI-PERSON AGENTIC BRAINSTORMING WORKFLOW DEMO")
    print(f"Loading conversation fixture from: {CONVERSATION_FILE}")
    print(f"Storage target: {IDEAS_FILE}")

    if not CONVERSATION_FILE.exists():
        print(f"Error: Fixture file '{CONVERSATION_FILE}' not found.")
        sys.exit(1)

    with open(CONVERSATION_FILE, "r", encoding="utf-8") as f:
        session_data: Dict[str, Any] = json.load(f)

    print(f"Session Title: {session_data.get('title')}")
    print(f"Session Topic: {session_data.get('topic')}")
    print(f"Participants: {len(session_data.get('participants', []))} stakeholders")
    for p in session_data.get("participants", []):
        print(f"  - {p['name']} ({p['role']}): {p['focus']}")

    target_idea_id = "voice-brainstorm-ai"

    # Step 1: Ensure boilerplate idea exists in data/ideas.json
    print_banner("STEP 1: INITIALIZING BOILERPLATE IDEA IN data/ideas.json", "-")
    existing_idea = await storage.get_idea(target_idea_id)
    if not existing_idea:
        initial_idea = Idea(
            id=target_idea_id,
            title="Voice-First Agentic Brainstorming Canvas",
            summary="Real-time voice capture canvas that clusters team dialogue into ideas.",
            proponents=["Marko (Founder)"],
            opponents=["Alex (Architect)"],
            thumbnail="thumbnails/brainstorm_canvas.png"
        )
        await storage.save_or_update_idea(initial_idea)
        print(f"Created initial boilerplate idea '{initial_idea.title}' in {IDEAS_FILE}")
    else:
        print(f"Found existing idea '{existing_idea.title}' in {IDEAS_FILE}")

    # Clear/reset transcript file for demo replay
    with open(TRANSCRIPT_FILE, "w", encoding="utf-8") as tf:
        tf.write(f"=== Session: {session_data.get('title')} ===\n\n")

    # Step 2: Iterate through speech turns and trigger agentic pipeline
    print_banner("STEP 2: INGESTING SPEECH TURNS & TRIGGERING AGENTS", "-")

    turns = session_data.get("turns", [])
    for turn in turns:
        t_num = turn.get("turn_number")
        speaker = turn.get("speaker")
        speech_text = turn.get("text")
        intended = turn.get("intended_trigger")

        print_turn_header(t_num, speaker)
        print(f'Speech: "{speech_text}"')
        print(f"Intended Agentic Trigger: \033[1;33m{intended}\033[0m")

        # 1. Append to continuous transcript file
        await storage.append_transcript(f"{speaker}: {speech_text}")

        # 2. Dispatch via Auto Router or Manual Service depending on turn intent
        if intended in ["workflow", "competitors", "pros_cons", "all"]:
            print(f"-> Invoking orchestrator.manual_dispatch(service='{intended}')...")
            result = await orchestrator.manual_dispatch(
                identifier=target_idea_id,
                service=intended,
                context=speech_text,
                run_in_background=False  # Synchronous for deterministic demo output
            )
        else:
            print(f"-> Invoking orchestrator.auto_evaluate_and_dispatch()...")
            result = await orchestrator.auto_evaluate_and_dispatch(
                identifier=target_idea_id,
                context_delta=speech_text,
                run_in_background=False
            )

        print(f"   Execution Result: Dispatched Tools = {result.get('dispatched_tools', [])}")

        # Display instantaneous delta update
        current_idea = await storage.get_idea(target_idea_id)
        if current_idea:
            print(f"   Active Tools: {current_idea.active_tools} | Status: {current_idea.status}")
            if intended == "workflow" and current_idea.workflow:
                print(f"   [Workflow Agent Result] Steps: {len(current_idea.workflow.steps)}")
                print(f"   [Workflow Summary]: {current_idea.workflow.summary}")
            elif intended == "competitors" and current_idea.competitors:
                print(f"   [Competitor Agent Result] Found {len(current_idea.competitors.competitors)} competitors:")
                for c in current_idea.competitors.competitors:
                    print(f"     * {c.name}: {c.summary}")
                print(f"   [Our Positioning]: {current_idea.competitors.our_positioning}")
            elif intended == "pros_cons" and current_idea.pros_cons:
                print(f"   [Pros/Cons Agent Result] Pros: {len(current_idea.pros_cons.pros)} | Cons: {len(current_idea.pros_cons.cons)}")
                print(f"   [Key Risks]: {current_idea.pros_cons.key_risks}")
                print(f"   [Proponents]: {current_idea.proponents}")
                print(f"   [Opponents]: {current_idea.opponents}")

        # Small pause between speech turns for readable output
        await asyncio.sleep(0.5)

    # Step 3: Inspect final persisted state in data/ideas.json
    print_banner("STEP 3: VERIFYING FINAL STATE IN data/ideas.json", "-")
    final_idea = await storage.get_idea(target_idea_id)
    assert final_idea is not None, "Error: Idea not found in storage!"

    print(f"\nIdea Title: \033[1;32m{final_idea.title}\033[0m (ID: {final_idea.id})")
    print(f"Status: {final_idea.status}")
    print(f"Summary: {final_idea.summary}\n")

    print("\033[1;34m=== PROPONENTS & OPPONENTS ===\033[0m")
    print(f"Proponents ({len(final_idea.proponents)}):")
    for p in final_idea.proponents:
        print(f"  (+) {p}")
    print(f"Opponents ({len(final_idea.opponents)}):")
    for o in final_idea.opponents:
        print(f"  (-) {o}")

    if final_idea.competitors:
        print("\n\033[1;34m=== COMPETITOR INTELLIGENCE & POSITIONING ===\033[0m")
        print(f"Market Landscape: {final_idea.competitors.market_landscape}")
        print(f"Our Unique Positioning: {final_idea.competitors.our_positioning}")
        print("Competitors Discovered:")
        for comp in final_idea.competitors.competitors:
            print(f"  - {comp.name}: {comp.summary} (Diff: {comp.differentiator})")

    if final_idea.workflow:
        print("\n\033[1;34m=== WORKFLOW & MERMAID DIAGRAM ===\033[0m")
        print(f"Workflow Summary: {final_idea.workflow.summary}")
        print("Steps:")
        for idx, s in enumerate(final_idea.workflow.steps, 1):
            print(f"  {idx}. {s}")
        print("\nGenerated Mermaid.js Syntax:")
        print(final_idea.workflow.mermaid_code)
        if final_idea.workflow.image_prompt:
            print(f"\nImage Generation Prompt:\n  \"{final_idea.workflow.image_prompt}\"")

    if final_idea.pros_cons:
        print("\n\033[1;34m=== PROS, CONS & CRITICAL RISKS ===\033[0m")
        print("Pros:")
        for p in final_idea.pros_cons.pros:
            print(f"  [+] {p}")
        print("Cons:")
        for c in final_idea.pros_cons.cons:
            print(f"  [-] {c}")
        print("Key Risks:")
        for r in final_idea.pros_cons.key_risks:
            print(f"  [!] {r}")
        print("Open Questions:")
        for q in final_idea.pros_cons.open_questions:
            print(f"  [?] {q}")

    print_banner("DEMO COMPLETED SUCCESSFULLY! data/ideas.json FULLY ENRICHED")


if __name__ == "__main__":
    asyncio.run(run_multi_person_demo())

