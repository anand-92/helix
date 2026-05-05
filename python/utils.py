"""Utility helpers for Helix."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from config import PROJECT_ROOT


def ensure_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def format_timestamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def pretty_json(data: dict[str, Any]) -> str:
    return json.dumps(data, indent=2)


def write_json(path: Path, data: dict[str, Any]) -> None:
    ensure_directory(path.parent)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


RUN_ARTIFACTS_DIR = PROJECT_ROOT / "python" / ".runs"
