"""Local backend for the Helix."""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import MEMORY_DB_PATH, MEMORY_ENABLED, SERVER_HOST, SERVER_PORT
from events import SystemEvent
from models import PipelineState, RunHistorySummary, RunStartResponse, RunStatusResponse
from orchestrator import PipelineOrchestrator
from persistence import load_all_runs, save_run

_DONE_STATUSES = frozenset({"completed", "failed", "stopped"})


class RunStartRequest(BaseModel):
    actions: list[str] | None = None
    prompt: str | None = None
    action_prompts: dict[str, str] | None = None


class ActionInfo(BaseModel):
    id: str
    title: str
    description: str
    enabled: bool
    is_finalizer: bool = False


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


class RunManager:
    def __init__(self) -> None:
        self.run_id: str | None = None
        self.status = "idle"
        self.output: list[str] = []
        self.logs: list[str] = []
        self.error: str | None = None
        self.current_action: str | None = None
        self.actions: list = []
        self.task: asyncio.Task | None = None
        self._run_history: dict[str, PipelineState] = load_all_runs()
        self._proto_orchestrator = PipelineOrchestrator()

    async def log(self, level: str, message: str) -> None:
        entry = message.strip()
        if not entry:
            return
        self.logs.append(f"[{level}] {entry}")
        if level == "output":
            self.output.append(entry)

    async def _runner(
        self,
        run_id: str,
        action_ids: list[str] | None = None,
        prompt: str | None = None,
        action_prompts: dict[str, str] | None = None,
    ) -> None:
        self.orchestrator = PipelineOrchestrator(logger=self.log)
        self.orchestrator.state.run_id = run_id
        try:
            result = await self.orchestrator.run_actions(
                action_ids=action_ids,
                prompt=prompt,
                action_prompts=action_prompts,
            )
            self.status = result.status
            self.current_action = result.current_action
            self.error = result.error
            self.actions = result.actions
            self.output = result.output
            self.logs = result.logs
        finally:
            state = self.orchestrator.state
            state.run_id = run_id
            self._run_history[run_id] = state
            with contextlib.suppress(Exception):
                save_run(state)

    async def start(
        self,
        action_ids: list[str] | None = None,
        prompt: str | None = None,
        action_prompts: dict[str, str] | None = None,
    ) -> RunStartResponse:
        if self.task and not self.task.done():
            raise HTTPException(status_code=409, detail="Run already in progress")

        self.run_id = str(uuid.uuid4())
        self.status = "running"
        self.output = []
        self.logs = []
        self.error = None
        self.current_action = None
        self.actions = []
        self.task = asyncio.create_task(
            self._runner(
                self.run_id, action_ids=action_ids, prompt=prompt, action_prompts=action_prompts
            )
        )
        return RunStartResponse(run_id=self.run_id, status=self.status)

    async def stop(self) -> RunStatusResponse:
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                self.status = "stopped"
        return self.snapshot()

    def snapshot(self) -> RunStatusResponse:
        if self.task and self.task.done() and self.status == "running":
            self.status = "completed"

        current_action = getattr(self, "current_action", None)
        actions = getattr(self, "actions", [])
        error = self.error
        events: list = []
        usage = None

        if self.status == "running" and hasattr(self, "orchestrator"):
            current_action = self.orchestrator.state.current_action
            actions = self.orchestrator.state.action_results
            error = self.orchestrator.state.error
            events = list(self.orchestrator.state.events)
            usage = self.orchestrator.state.usage
        elif self.run_id and self.run_id in self._run_history:
            hist = self._run_history[self.run_id]
            events = list(hist.events)
            usage = hist.usage
            actions = hist.action_results

        return RunStatusResponse(
            run_id=self.run_id,
            status=self.status,
            current_action=current_action,
            current_stage=None,
            output=self.output,
            logs=self.logs,
            actions=actions,
            stages=actions,
            error=error,
            events=events,
            usage=usage,
        )

    def _has_run(self, run_id: str) -> bool:
        return (self.run_id == run_id) or (run_id in self._run_history)

    def _get_run_events(self, run_id: str) -> list[dict[str, Any]]:
        if run_id in self._run_history:
            return list(self._run_history[run_id].events)
        if self.run_id == run_id and hasattr(self, "orchestrator"):
            return list(self.orchestrator.state.events)
        return []

    def _get_run_status(self, run_id: str) -> str:
        if run_id in self._run_history:
            return self._run_history[run_id].status
        if self.run_id == run_id:
            if self.task is not None and not self.task.done():
                return "running"
            if hasattr(self, "orchestrator"):
                return self.orchestrator.state.status
            return self.status
        return "unknown"


manager = RunManager()

app = FastAPI(
    title="Helix API",
    description="Local backend for starting, stopping, and monitoring agent runs.",
    version="0.1.0",
)

# Lazy-initialized memory store for admin/debug API routes.
_memory_store = None


def _get_memory_store():
    global _memory_store
    if not MEMORY_ENABLED:
        raise HTTPException(status_code=503, detail="Memory is disabled")
    if _memory_store is None:
        from memory.store import MemoryStore

        _memory_store = MemoryStore(MEMORY_DB_PATH)
        _memory_store.init_schema()
    return _memory_store


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/actions", response_model=list[ActionInfo])
async def list_actions() -> list[ActionInfo]:
    return [
        ActionInfo(
            id=action.id,
            title=action.title,
            description=action.description,
            enabled=action.enabled,
            is_finalizer=action.is_finalizer,
        )
        for action in manager._proto_orchestrator.action_registry.get_all()
    ]


@app.get("/memory/memories")
async def list_memories(
    kind: str | None = None,
    is_active: bool | None = None,
    limit: int = Query(default=100, ge=0, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    store = _get_memory_store()
    rows = store.get_memories(
        kind=kind,
        is_active=is_active,
        include_inactive=(is_active is None),
        limit=limit,
        offset=offset,
    )
    return [
        {
            "id": row["id"],
            "kind": row["kind"],
            "content": row.get("content"),
            "is_active": row["is_active"],
        }
        for row in rows
    ]


@app.get("/memory/memories/{memory_id}")
async def get_memory_detail(memory_id: str) -> dict[str, Any]:
    store = _get_memory_store()
    memory = store.get_memory(memory_id)
    if memory is None:
        raise HTTPException(status_code=404, detail="Memory not found")

    embeddings = store.get_embedding_metadata_for_memory(memory_id)
    media_rows = store.get_media_for_memory(memory_id)
    media: list[dict[str, Any]] = []
    for row in media_rows:
        row_copy = dict(row)
        data_blob = row_copy.pop("data_blob", None)
        row_copy["has_data_blob"] = data_blob is not None
        media.append(row_copy)

    return {
        **memory,
        "embeddings": embeddings,
        "media": media,
    }


@app.get("/memory/stats")
async def memory_stats() -> dict[str, Any]:
    store = _get_memory_store()
    return store.get_memory_stats()


@app.post("/runs/start", response_model=RunStartResponse)
async def start_run(body: RunStartRequest | None = None) -> RunStartResponse:
    req = body or RunStartRequest()
    return await manager.start(
        action_ids=req.actions,
        prompt=req.prompt,
        action_prompts=req.action_prompts,
    )


@app.post("/runs/stop", response_model=RunStatusResponse)
async def stop_run() -> RunStatusResponse:
    return await manager.stop()


@app.get("/runs/status", response_model=RunStatusResponse)
async def run_status() -> RunStatusResponse:
    return manager.snapshot()


@app.get("/runs/{run_id}/events")
async def run_events(run_id: str) -> list[dict[str, Any]]:
    if run_id not in manager._run_history:
        raise HTTPException(status_code=404, detail="Run not found")
    return list(manager._run_history[run_id].events)


@app.get("/runs/history", response_model=list[RunHistorySummary])
async def run_history() -> list[RunHistorySummary]:
    summaries = [
        RunHistorySummary(
            run_id=run_id,
            status=state.status,
            started_at=state.started_at,
            completed_at=state.completed_at,
            stage_count=len(state.action_results),
            usage=state.usage,
        )
        for run_id, state in manager._run_history.items()
    ]
    summaries.sort(
        key=lambda s: s.started_at or _EPOCH,
        reverse=True,
    )
    return summaries


@app.websocket("/ws/runs/{run_id}")
async def websocket_run(websocket: WebSocket, run_id: str) -> None:
    if not manager._has_run(run_id):
        await websocket.accept()
        await websocket.close(code=4004, reason="not found")
        return

    await websocket.accept()
    cursor = 0

    try:
        while True:
            events = manager._get_run_events(run_id)
            status = manager._get_run_status(run_id)

            while cursor < len(events):
                await websocket.send_text(json.dumps(events[cursor]))
                cursor += 1

            if status in _DONE_STATUSES:
                final_event = SystemEvent(
                    run_id=run_id,
                    action="run_complete",
                    metadata={"final_status": status},
                )
                await websocket.send_text(json.dumps(final_event.model_dump(mode="json")))
                await websocket.close(code=1000)
                return

            await asyncio.sleep(0.05)

    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass


@app.get("/logs/raw")
async def raw_logs(last: int = 500) -> dict[str, Any]:
    log_path = Path("./logs/backend-err.log")
    lines: list[str] = []
    if log_path.exists():
        try:
            text = log_path.read_text(encoding="utf-8", errors="replace")
            lines = [line for line in text.splitlines() if line.strip()][-last:]
        except OSError:
            pass
    return {"lines": lines}


@app.get("/logs/run")
async def run_logs() -> dict[str, Any]:
    return {"lines": manager.logs}


def main() -> None:
    import uvicorn

    from logging_config import setup_logging

    setup_logging()
    uvicorn.run(
        app,
        host=SERVER_HOST,
        port=SERVER_PORT,
        log_config=None,
    )


if __name__ == "__main__":
    main()
