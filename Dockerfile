FROM ghcr.io/astral-sh/uv:0.9.8 AS uv

FROM python:3.13-slim AS python-base
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1

FROM python-base AS transcriber
WORKDIR /app/backend/transcriber
COPY backend/transcriber/pyproject.toml backend/transcriber/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/transcriber/main.py backend/transcriber/speakers.py ./
ENV TRANSCRIBER_PORT=8000
EXPOSE 8000
CMD [".venv/bin/python", "main.py"]

FROM python-base AS engine
WORKDIR /app/backend/engine
COPY backend/engine/pyproject.toml backend/engine/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/engine/main.py backend/engine/prompt.py ./
CMD [".venv/bin/python", "main.py"]

FROM python-base AS enricher
WORKDIR /app
COPY backend/enrichment/requirements.txt ./requirements.txt
RUN uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
COPY backend/enrichment ./backend/enrichment
EXPOSE 8001
CMD [".venv/bin/python", "-m", "uvicorn", "backend.enrichment.main:app", "--host", "0.0.0.0", "--port", "8001"]

FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
EXPOSE 5173
# The source mount can contain an updated lockfile after a teammate's pull.
CMD ["sh", "-c", "npm ci --prefer-offline && exec npm run dev -- --host 0.0.0.0 --strictPort"]
