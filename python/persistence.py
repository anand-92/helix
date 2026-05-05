"""File-based persistence layer for run history.

Each completed run is serialised to a JSON file in the .runs/ directory,
named ``<run_id>.json``.  Writes are atomic: data is first written to a
temporary file *in the same directory* (guaranteeing same-filesystem),
then renamed with ``os.replace``.  On POSIX systems ``os.replace`` is a
guaranteed atomic rename; on Windows it is a best-effort atomic replace
(works for our single-writer, single-reader use-case).

On server startup ``load_all_runs()`` scans the directory and restores the
full ``PipelineState`` for every persisted run, allowing the history
endpoint to serve data that survives restarts.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path

import structlog

from models import PipelineState

logger = structlog.get_logger(__name__)

# Directory where run JSON files are stored.
# Relative to the server's working directory (repo root).
RUNS_DIR = Path(".runs")


def _ensure_runs_dir() -> Path:
    """Ensure the .runs/ directory exists and return its Path."""
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    return RUNS_DIR


def save_run(state: PipelineState) -> None:
    """Atomically persist *state* to ``<RUNS_DIR>/<run_id>.json``.

    If ``state.run_id`` is ``None`` or empty this is a no-op.

    The write is atomic: the payload is first written to a temporary file
    in ``RUNS_DIR`` (same filesystem), then renamed over the target path
    with ``os.replace`` so that a partial write can never leave a corrupt
    file in place.
    """
    run_id = state.run_id
    if not run_id:
        return

    runs_dir = _ensure_runs_dir()
    target = runs_dir / f"{run_id}.json"

    data = state.model_dump(mode="json")

    # Write to a temp file in the same directory, then rename atomically.
    fd, tmp_path = tempfile.mkstemp(
        dir=runs_dir,
        suffix=".tmp",
        prefix=f"{run_id}_",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, default=str)
        os.replace(tmp_path, target)
    except Exception:
        # Clean up the orphaned temp file on any error.
        with contextlib.suppress(OSError):
            os.unlink(tmp_path)
        raise


def load_all_runs() -> dict[str, PipelineState]:
    """Load all persisted run files from ``RUNS_DIR``.

    Returns a ``dict`` mapping ``run_id`` → ``PipelineState``.
    Files that cannot be read or parsed are skipped with a warning so that
    a single corrupt file never prevents the server from starting.
    """
    if not RUNS_DIR.exists():
        return {}

    result: dict[str, PipelineState] = {}
    for run_file in sorted(RUNS_DIR.glob("*.json")):
        try:
            with run_file.open("r", encoding="utf-8") as fh:
                raw = json.load(fh)
            state = PipelineState.model_validate(raw)
            if state.run_id:
                result[state.run_id] = state
        except Exception as exc:
            logger.warning("Skipping unparseable run file %s: %s", run_file, exc)

    return result
