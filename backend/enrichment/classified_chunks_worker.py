"""Continuously forward appended classified JSONL chunks to the enrichment API.

Each line is either one ``{"chunk": ..., "ideas": [...]}`` object or the
existing ``{"chunks": [...]}`` request shape. The byte offset is checkpointed
only after the API accepts a line, so restarts do not replay completed input.
Backend chunk IDs and per-idea transcript segments provide a second layer of
deduplication.
"""

import argparse
import json
import time
from pathlib import Path
from typing import Any

import httpx


def load_offset(state_path: Path) -> int:
    try:
        return max(0, int(json.loads(state_path.read_text(encoding="utf-8"))["byte_offset"]))
    except (FileNotFoundError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return 0


def save_offset(state_path: Path, byte_offset: int) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = state_path.with_suffix(f"{state_path.suffix}.tmp")
    temporary.write_text(
        json.dumps({"byte_offset": byte_offset}, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(state_path)


def request_payload(record: Any) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise ValueError("Each JSONL line must contain a JSON object.")
    chunks = record.get("chunks") if "chunks" in record else [record]
    if not isinstance(chunks, list):
        raise ValueError("The 'chunks' value must be a list.")
    return {"chunks": chunks, "process_now": True}


def run_worker(
    input_path: Path,
    state_path: Path,
    api_url: str,
    interval: float,
    once: bool,
) -> None:
    endpoint = f"{api_url.rstrip('/')}/transcript/classified-chunks"
    offset = load_offset(state_path)
    print(f"[classified-router] Watching {input_path} from byte {offset}")

    with httpx.Client(timeout=None) as client:
        while True:
            if not input_path.exists():
                if once:
                    raise FileNotFoundError(input_path)
                time.sleep(interval)
                continue

            file_size = input_path.stat().st_size
            if offset > file_size:
                print("[classified-router] Input was truncated; restarting at byte 0")
                offset = 0
                save_offset(state_path, offset)

            progressed = False
            with input_path.open("rb") as stream:
                stream.seek(offset)
                while True:
                    line_start = stream.tell()
                    line = stream.readline()
                    if not line:
                        break
                    if not line.endswith(b"\n") and not once:
                        break

                    next_offset = stream.tell()
                    if not line.strip():
                        offset = next_offset
                        save_offset(state_path, offset)
                        progressed = True
                        continue

                    try:
                        record = json.loads(line.decode("utf-8"))
                        response = client.post(endpoint, json=request_payload(record))
                        response.raise_for_status()
                    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                        raise RuntimeError(f"Invalid JSONL at byte {line_start}: {exc}") from exc
                    except httpx.HTTPError as exc:
                        print(f"[classified-router] API unavailable at byte {line_start}: {exc}")
                        break

                    result = response.json()
                    offset = next_offset
                    save_offset(state_path, offset)
                    progressed = True
                    print(
                        f"[classified-router] Processed byte {line_start}: "
                        f"{len(result.get('jobs', []))} idea job(s)"
                    )

            if once:
                return
            if not progressed:
                time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Tail classified transcript JSONL and run the per-idea enrichment workflow."
    )
    parser.add_argument("--file", type=Path, default=Path("pubsub/classified-chunks.jsonl"))
    parser.add_argument("--state-file", type=Path, default=None)
    parser.add_argument("--api-url", default="http://127.0.0.1:8001")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--once", action="store_true", help="Process available complete lines, then exit.")
    args = parser.parse_args()

    state_path = args.state_file or args.file.with_suffix(f"{args.file.suffix}.offset.json")
    run_worker(args.file, state_path, args.api_url, max(0.1, args.interval), args.once)


if __name__ == "__main__":
    main()
