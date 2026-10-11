"""Run and time the complete enrichment pipeline for one stored idea."""

import argparse
import asyncio
import json
import time

from .orchestrator import orchestrator
from .storage import storage


async def run(idea_id: str):
    started = time.perf_counter()
    result = await orchestrator.enrich_idea_from_transcript(idea_id)
    elapsed = time.perf_counter() - started
    idea = await storage.get_idea(idea_id)
    folder = storage.artifacts.write(idea)
    record = storage.artifacts.record_for(idea.id)
    print(json.dumps({
        "idea_id": idea_id,
        "status": result["status"],
        "elapsed_seconds": round(elapsed, 2),
        "execution": result["execution"],
        "per_idea_json": str(record.resolve()),
        "artifact_directory": str(folder.resolve()),
        "artifact_files": sorted(path.name for path in folder.iterdir() if path.is_file()),
    }, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--idea-id", required=True)
    args = parser.parse_args()
    asyncio.run(run(args.idea_id))


if __name__ == "__main__":
    main()
