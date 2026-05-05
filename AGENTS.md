# Helix Agent Guidelines

These guidelines apply when you (an AI agent) are working on the Helix codebase.

## Architecture

Helix is a dual-stack agent framework:

- **Frontend** — React 19 + Vite + TypeScript dashboard. Connects to backend via HTTP/REST and WebSocket.
- **Backend** — FastAPI + Claude Agent SDK (Python). The orchestrator executes actions and streams events.

## Common Commands

- Install backend deps: `uv sync`
- Install frontend deps: `npm --prefix frontend install`
- Start both services: `./scripts/start-dev.sh`
- Start frontend only: `npm --prefix frontend run dev -- --host 127.0.0.1`
- Run all actions: `uv run python python/main.py`
- List available actions: `uv run python python/main.py --list-actions`
- Run specific actions: `uv run python python/main.py --actions hello`
- Run with prompt: `uv run python python/main.py --actions hello --prompt "Say something fun"`
- Lint frontend: `npm --prefix frontend run lint`
- Build frontend: `npm --prefix frontend run build`
- Lint Python: `uv run ruff check python`
- Format Python: `uv run ruff format python`

## Architecture Details

- `python/server.py` exposes the FastAPI control API on `127.0.0.1:8000` with `/health`, `/actions`, `/runs/start`, `/runs/stop`, `/runs/status`, and `/ws/runs/{run_id}` WebSocket.
- `python/orchestrator.py` is the runtime core. It maintains an `ActionRegistry` of all available actions and exposes `run_actions(action_ids, prompt, action_prompts)` to execute any subset in order. Actions within a run share a single SDK session.
- `python/agents/` contains one `action_*.py` file per action. Each defines an `AgentDefinition` with its own prompt.
- The frontend is a React 19 + Vite + TypeScript dashboard. The Dashboard shows toggleable action cards and a global prompt input.
- Styling is Tailwind-based, `@/*` aliases point to `frontend/src`, shared class merging lives in `frontend/src/lib/utils.ts`.
- **Finalizer reordering**: `run_actions()` automatically moves actions with `is_finalizer=True` to the end.

## Adding a New Action

1. Add `python/agents/action_<name>.py` with an `AgentDefinition`
2. Export it from `python/agents/__init__.py`
3. Register it in `python/orchestrator.py` `_register_actions()` and `_ACTION_PROMPTS`

## Memory Subsystem

Memory is **disabled by default**. Enable with:
- `MEMORY_ENABLED=true` in `.env`
- `GEMINI_API_KEY=<key>` in `.env`

The infrastructure is fully built out in `python/memory/`. The DB is auto-created on first use.

## Naming Conventions

- **TypeScript (frontend)**: `camelCase` for variables/functions, `PascalCase` for components/types.
- **Python (backend)**: `snake_case` for variables/functions/modules, `PascalCase` for classes, `UPPER_CASE` for constants.
- **Files**: Frontend components use `PascalCase.tsx`. Python modules use `snake_case.py`. Actions follow `action_<name>.py`.

## Code Quality

- Lint frontend: `npm --prefix frontend run lint`
- Format frontend: `npm --prefix frontend run format`
- Lint Python: `uv run ruff check python`
- Format Python: `uv run ruff format python`
