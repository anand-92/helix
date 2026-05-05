# Helix

Helix is an action-based AI agent framework with a real-time React observability dashboard.

## Project Structure

```
helix/
  frontend/         React 19 + Vite + TypeScript dashboard (port 5173)
  python/           FastAPI backend + Claude Agent SDK runtime (port 8000)
    agents/         AgentDefinition files — one per action
    memory/         Optional persistent memory (disabled by default)
    orchestrator.py Core runtime — executes actions, emits events
    server.py       FastAPI control API + WebSocket
    config.py       All configuration via env vars
    main.py         CLI entry point
  guides/           Claude Agent SDK reference docs (see below)
  .claude/
    skills/         Claude skills (find-skills included)
    output-styles/  Output style presets
  scripts/          start-dev.sh / start-dev.ps1
```

## How This Works

- Actions are `AgentDefinition` objects from the Claude Agent SDK, defined in `python/agents/action_*.py`
- The orchestrator runs selected actions in order, sharing a single SDK session so each action has full context from prior actions
- The frontend connects via WebSocket (`/ws/runs/{id}`) to receive real-time event streams
- Every run is persisted to `.runs/` as JSON for later analysis

## Adding a New Action

1. Create `python/agents/action_<name>.py` with an `AgentDefinition`
2. Export it from `python/agents/__init__.py`
3. Register it in `python/orchestrator.py` `_register_actions()` and `_ACTION_PROMPTS`
4. (Optional) Set `is_finalizer=True` on the definition to auto-reorder it to the end of the pipeline

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Runtime | Claude Agent SDK (Python) |
| Backend API | FastAPI + Uvicorn |
| Frontend | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS 4 + shadcn/ui |
| State | Zustand |
| Animations | Framer Motion |
| Package Manager | uv (Python), npm (Node) |

## Commands

```bash
# Install dependencies
uv sync
npm --prefix frontend install

# Start both backend + frontend
./scripts/start-dev.sh

# Backend only
uv run python python/server.py

# Frontend only
npm --prefix frontend run dev

# Run actions via CLI
uv run python python/main.py --actions hello
uv run python python/main.py --actions hello --prompt "Build a todo app"

# Lint & format
npm --prefix frontend run lint
uv run ruff check python
uv run ruff format python
```

## Authentication

The Claude Agent SDK handles auth automatically:

- **Claude Code OAuth subscription** — Works out of the box, no API key needed.
- **Anthropic API key** — Set `ANTHROPIC_API_KEY` in `.env`.
- **Other providers** — Set `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` in `.claude/settings.json`. See `.claude/settings.minimax.json` for an example.

## Environment Variables

- `ANTHROPIC_API_KEY` — Optional. Only needed if not using Claude Code OAuth.
- `MEMORY_ENABLED` — Optional. Set `true` to enable persistent memory.
- `GEMINI_API_KEY` — Only if memory enabled. For memory embeddings.

## Claude Agent SDK Reference

The `guides/` directory contains full reference documentation for the Claude Agent SDK. Consult these when working on SDK-related features or actions:

| Guide | Topic |
|-------|-------|
| `guides/overview.md` | SDK introduction, auth, core concepts |
| `guides/python.md` | Python SDK usage, `AgentDefinition`, `ClaudeAgentOptions` |
| `guides/quickstart.md` | Getting started with Agent Skills |
| `guides/sessions.md` | Session management and lifecycle |
| `guides/skills.md` | Creating and using custom skills |
| `guides/subagents.md` | Launching subagents programmatically |
| `guides/mcp.md` | Model Context Protocol (MCP) integration |
| `guides/permissions.md` | Tool permissions and access control |
| `guides/streaming-vs-single-mode.md` | Streaming vs single-response modes |
| `guides/structured-outputs.md` | Enforcing structured output formats |
| `guides/modifying-system-prompts.md` | Custom system prompts and CLAUDE.md |
| `guides/slash-commands.md` | Custom slash commands |
| `guides/plugins.md` | SDK plugin system |
| `guides/todo-tracking.md` | Built-in todo tracking |
| `guides/cost-tracking.md` | Token cost tracking |
| `guides/custom-tools.md` | Building custom tools |
| `guides/hosting.md` | Deploying agents |

## Conventions

- **Python**: `snake_case` variables/functions/modules, `PascalCase` classes, `UPPER_CASE` constants.
- **TypeScript**: `camelCase` variables/functions, `PascalCase` components/types.
- Action files: `action_<name>.py`
- Frontend components: `PascalCase.tsx`
