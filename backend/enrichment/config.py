import os
from pathlib import Path
from dotenv import load_dotenv

# Paths
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
IDEAS_FILE = DATA_DIR / "ideas.json"
TRANSCRIPT_FILE = DATA_DIR / "transcript.txt"
IDEA_ARTIFACTS_DIR = DATA_DIR / "ideas"

# Keep local development predictable: `cp .env.example .env` works whether
# uvicorn is launched from the repository root or this service directory.
load_dotenv(PROJECT_ROOT / ".env")

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

# LLM Configurations
DEFAULT_PROVIDER = os.getenv("DEFAULT_PROVIDER", "auto")  # "gemini", "openai", "auto", "mock"
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_FAST_MODEL = os.getenv("GEMINI_FAST_MODEL", "gemini-flash-lite-latest")
# SVGs use a text-capable model through the existing provider connection.
THUMBNAILS_ENABLED = os.getenv("THUMBNAILS_ENABLED", "true").lower() not in {"0", "false", "no"}
THUMBNAIL_MODEL = os.getenv("THUMBNAIL_MODEL") or GEMINI_MODEL
THUMBNAIL_TIMEOUT_SECONDS = float(os.getenv("THUMBNAIL_TIMEOUT_SECONDS", "60"))
GROUNDED_SEARCH_TIMEOUT_SECONDS = float(
    os.getenv("GROUNDED_SEARCH_TIMEOUT_SECONDS", "20")
)
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "120"))

# Microservice Server Config
SERVER_HOST = os.getenv("ENRICHMENT_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("ENRICHMENT_PORT", "8001"))
