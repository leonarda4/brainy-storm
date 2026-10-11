"""Bash-friendly live model connectivity check.

Examples:
    python -m backend.enrichment.ping_models --provider gemini
    python -m backend.enrichment.ping_models --provider openai
"""

import argparse
import asyncio
import json

from .llm_client import llm_client


async def _run(provider: str) -> int:
    try:
        result = await llm_client.ping_models(provider)
        print(json.dumps(result, indent=2))
        return 0 if result["ok"] else 1
    finally:
        await llm_client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a minimal real request to configured LLMs.")
    parser.add_argument(
        "--provider",
        choices=("gemini", "openai", "all"),
        default="all",
        help="Provider to test; 'all' requires both providers to succeed.",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(args.provider)))


if __name__ == "__main__":
    main()
