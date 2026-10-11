"""Start and monitor the complete local stack; `./dev status` checks it.

Existing processes from this checkout are reused and never stopped by this
launcher. New processes are owned by the launcher and stopped on Ctrl-C.
Fail visibly on a process exit rather than restarting the classifier and
truncating its topics underneath an in-flight enrichment request.
"""

import argparse
from dataclasses import dataclass
import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".runtime"


@dataclass(frozen=True)
class Service:
    name: str
    command: tuple[str, ...]
    cwd: Path
    marker: str
    port: int | None = None
    health: str | None = None


def services():
    python = str(ROOT / ".venv/bin/python")
    return [
        Service("enrichment", (python, "-u", "-m", "uvicorn", "backend.enrichment.main:app",
                "--host", "127.0.0.1", "--port", "8001"), ROOT, "backend.enrichment.main:app", 8001, "ok"),
        Service("transcriber", (str(ROOT / "backend/transcriber/.venv/bin/python"), "-u", "-m",
                "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8010",
                "--timeout-graceful-shutdown", "60"), ROOT / "backend/transcriber", "main:app", 8010, "ready"),
        Service("classifier", (str(ROOT / "backend/engine/.venv/bin/python"), "-u",
                str(ROOT / "backend/engine/main.py")), ROOT / "backend/engine", "main.py"),
        Service("worker", (python, "-u", "-m", "backend.enrichment.classified_chunks_worker",
                "--file", str(ROOT / "pubsub/classified-chunks.jsonl"),
                "--api-url", "http://127.0.0.1:8001", "--interval", "1"),
                ROOT, "backend.enrichment.classified_chunks_worker"),
        Service("frontend", (shutil.which("node") or "node", str(ROOT / "frontend/node_modules/vite/bin/vite.js"),
                "--host", "127.0.0.1", "--port", "5173", "--strictPort"), ROOT / "frontend", "vite", 5173),
    ]


def process_table():
    result = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True, check=True)
    processes = {}
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 1)
        if len(fields) == 2:
            processes[int(fields[0])] = fields[1]
    return processes


def matches(service, command):
    # Match executable + argument tokens, never shell commands mentioning them.
    try:
        args = shlex.split(command)
    except ValueError:
        return False
    if not args:
        return False
    if service.port:
        for index, arg in enumerate(args):
            if arg == "--port" and index + 1 < len(args) and args[index + 1] != str(service.port):
                return False
            if arg.startswith("--port=") and arg.partition("=")[2] != str(service.port):
                return False
    if service.name == "frontend":
        return Path(args[0]).name == "node" and any(arg in {
            str(ROOT / "frontend/node_modules/.bin/vite"),
            str(ROOT / "frontend/node_modules/vite/bin/vite.js"),
        } for arg in args[1:])
    if not args[0].startswith(str(ROOT) + "/") or not Path(args[0]).name.startswith("python"):
        return False
    if service.name == "classifier":
        return str(ROOT / "backend/engine/main.py") in args or (
            args[0].startswith(str(ROOT / "backend/engine/.venv") + "/") and "main.py" in args)
    if service.name == "transcriber" and "main.py" in args:
        return args[0].startswith(str(ROOT / "backend/transcriber/.venv") + "/")
    return service.marker in args


def find_process(service, table):
    found = [pid for pid, command in table.items() if matches(service, command)]
    if len(found) > 1:
        raise RuntimeError(f"Multiple {service.name} processes: {found}. Stop the duplicates first.")
    return found[0] if found else None


def get_json(url):
    with urllib.request.urlopen(url, timeout=3) as response:
        return json.load(response)


def healthy(service):
    try:
        url = f"http://127.0.0.1:{service.port}"
        if service.health:
            return get_json(url + "/health").get("status") == service.health
        with urllib.request.urlopen(url, timeout=3) as response:
            return response.status == 200
    except (OSError, ValueError, AttributeError):
        return False


def port_in_use(port):
    with socket.socket() as connection:
        connection.settimeout(1)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def preflight(stack):
    try:
        from dotenv import dotenv_values
    except ImportError as exc:
        raise RuntimeError("Install shared dependencies: .venv/bin/pip install -r requirements.txt") from exc

    settings = {**dotenv_values(ROOT / ".env"), **os.environ}
    for key in ("GRADIUM_API_KEY", "GEMINI_API_KEY"):
        value = (settings.get(key) or "").strip()
        if not value or value.startswith(("your_", "your-")):
            raise RuntimeError(f"Set {key} in the root .env before starting.")
    checks = {
        ROOT / ".venv/bin/python": "import uvicorn, httpx, google.genai, aiofiles, openai, dotenv",
        ROOT / "backend/transcriber/.venv/bin/python": "import uvicorn, gradium, aiohttp, dotenv",
        ROOT / "backend/engine/.venv/bin/python": "import google.genai, pydantic, dotenv",
    }
    for python, imports in checks.items():
        if not python.is_file():
            raise RuntimeError(f"Missing {python.relative_to(ROOT)}. See README local setup.")
        check = subprocess.run([str(python), "-c", imports], capture_output=True, timeout=30)
        if check.returncode:
            raise RuntimeError(f"Dependencies missing in {python.relative_to(ROOT)}. See README local setup.")
    if not shutil.which("node") or not Path(stack[-1].command[1]).is_file():
        raise RuntimeError("Install Node.js and run npm ci --prefix frontend first.")


def start_service(service, table, owned):
    pid = find_process(service, table)
    if pid:
        print(f"Reusing {service.name} (PID {pid}).", flush=True)
    else:
        if service.port and port_in_use(service.port):
            raise RuntimeError(f"Port {service.port} is occupied by another process; cannot start {service.name}.")
        env = {**os.environ, "PYTHONUNBUFFERED": "1",
               "TRANSCRIBER_TARGET": "http://127.0.0.1:8010", "ENRICHMENT_TARGET": "http://127.0.0.1:8001",
               "ENRICHMENT_API_PREFIX": "", "VITE_TRANSCRIBER_URL": "/api/transcriber",
               "VITE_ENRICHMENT_URL": "/api/enrichment", "VITE_IDEAS_URL": "/api/enrichment"}
        with (RUNTIME / f"{service.name}.log").open("ab") as log:
            process = subprocess.Popen(service.command, cwd=service.cwd, env=env,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True)
        owned[service.name] = process
        pid = process.pid
        print(f"Started {service.name} (PID {pid}); log: .runtime/{service.name}.log", flush=True)
    deadline = time.monotonic() + 30
    while True:
        process = owned.get(service.name)
        if process and process.poll() is not None:
            raise RuntimeError(f"{service.name} exited; check .runtime/{service.name}.log")
        if not service.port or healthy(service):
            return pid
        if time.monotonic() >= deadline:
            raise RuntimeError(f"{service.name} did not become healthy on port {service.port} within 30 seconds.")
        time.sleep(0.5)


def stop_owned(owned):
    # Allow the transcriber to finish attribution and save its final batch.
    for process in reversed(list(owned.values())):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
    deadline = time.monotonic() + 65
    for process in owned.values():
        try:
            process.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def check_routes():
    for route, expected in (("transcriber", "ready"), ("enrichment", "ok")):
        try:
            if get_json(f"http://127.0.0.1:5173/api/{route}/health").get("status") != expected:
                raise ValueError("Unexpected service response")
        except (OSError, ValueError, AttributeError) as exc:
            raise RuntimeError(f"Frontend /api/{route} proxy failed. Restart the frontend with ./dev.") from exc


def status(stack):
    table = process_table()
    ready = True
    for service in stack:
        pid = find_process(service, table)
        ok = bool(pid) and (not service.port or healthy(service))
        print(f"{service.name:12} {'OK' if ok else 'DOWN':4}  PID {pid or '-'}")
        ready &= ok
    try:
        check_routes()
        print("Browser API routes: OK")
    except RuntimeError as exc:
        print(exc)
        ready = False
    topic = ROOT / "pubsub/classified-chunks.jsonl"
    try:
        offset = json.loads(topic.with_suffix(".jsonl.offset.json").read_text())["byte_offset"]
        raw = topic.read_bytes()
        pending = raw[offset:] if 0 <= offset <= len(raw) else raw
        print(f"Classified backlog: {len(pending.splitlines())} records ({len(pending)} bytes)")
    except (OSError, ValueError, KeyError, TypeError):
        print("Classified backlog: checkpoint not available yet")
    try:
        jobs = get_json("http://127.0.0.1:8001/enrichment/queue/jobs")["jobs"]
        counts = {state: sum(job["status"] == state for job in jobs)
                  for state in ("queued", "running", "completed", "skipped", "failed")}
        print("Enrichment jobs: " + ", ".join(f"{state}={count}" for state, count in counts.items()))
        ready &= counts["failed"] == 0
    except (OSError, ValueError, KeyError, TypeError):
        print("Enrichment queue: unavailable")
        ready = False
    return 0 if ready else 1


def run(stack):
    RUNTIME.mkdir(exist_ok=True)
    with (RUNTIME / "dev.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("The local launcher is already running. Use ./dev status.")
        preflight(stack)
        owned = {}
        try:
            table = process_table()
            pids = {service.name: start_service(service, table, owned) for service in stack}
            check_routes()
            print("\nAll five services are running: http://127.0.0.1:5173", flush=True)
            print("Keep this terminal open. Ctrl-C stops only services started here; reused services stay running.", flush=True)
            while True:
                time.sleep(2)
                table = process_table()
                for service in stack:
                    process = owned.get(service.name)
                    if (process and process.poll() is not None) or not matches(service, table.get(pids[service.name], "")):
                        raise RuntimeError(f"{service.name} stopped. Check its log, then run ./dev again.")
        finally:
            stop_owned(owned)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("up", "status"), nargs="?", default="up")
    args = parser.parse_args()
    def interrupt(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        if args.action == "status":
            return status(services())
        run(services())
        return 0
    except KeyboardInterrupt:
        print("\nLauncher stopped. Previously running services were left running.")
        return 0
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print(f"\nStartup/health check failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
