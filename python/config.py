"""Configuration for Helix."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
PYTHON_ROOT = Path(__file__).parent
SKILLS_DIR = PROJECT_ROOT / ".claude" / "skills"

CWD = PYTHON_ROOT

SERVER_HOST = "0.0.0.0"
SERVER_PORT = 8000
FRONTEND_PORT = 5173

# ---------------------------------------------------------------------------
# Memory subsystem configuration (disabled by default)
# ---------------------------------------------------------------------------

MEMORY_ENABLED = os.environ.get("MEMORY_ENABLED", "false").lower() in ("true", "1", "yes")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
MEMORY_DB_PATH = PROJECT_ROOT / ".memory" / "memory.db"
MEMORY_EMBED_MODEL = os.environ.get("MEMORY_EMBED_MODEL", "gemini-embedding-2-preview")
MEMORY_EMBED_DIM = int(os.environ.get("MEMORY_EMBED_DIM", "768"))
MEMORY_MAX_CANDIDATES = int(os.environ.get("MEMORY_MAX_CANDIDATES", "50"))
MEMORY_MAX_INJECTED = int(os.environ.get("MEMORY_MAX_INJECTED", "5"))
MEMORY_DEDUP_THRESHOLD = float(os.environ.get("MEMORY_DEDUP_THRESHOLD", "0.92"))
MEMORY_MEDIA_DIR = Path(os.environ.get("MEMORY_MEDIA_DIR", str(PROJECT_ROOT / ".memory" / "media")))
MEMORY_MEDIA_INLINE_MAX_BYTES = int(os.environ.get("MEMORY_MEDIA_INLINE_MAX_BYTES", "262144"))
MEMORY_CONSOLIDATION_SIMILARITY_THRESHOLD: float | None = (
    float(v) if (v := os.environ.get("MEMORY_CONSOLIDATION_SIMILARITY_THRESHOLD")) else None
)
MEMORY_CONSOLIDATION_RUN_INTERVAL: int = int(
    os.environ.get("MEMORY_CONSOLIDATION_RUN_INTERVAL", "0")
)
MEMORY_FACT_CONFIRM_THRESHOLD: float = float(
    os.environ.get("MEMORY_FACT_CONFIRM_THRESHOLD", "0.85")
)
