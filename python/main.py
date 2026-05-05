#!/usr/bin/env python3
"""CLI entry point for Helix."""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from events import (
    AgentMessageEvent,
    ErrorEvent,
    MCPToolEvent,
    SubagentEvent,
    SystemEvent,
    ToolCallEvent,
)
from orchestrator import PipelineOrchestrator


def _compact(value, limit: int = 260) -> str:
    if value is None:
        return "null"
    try:
        text = json.dumps(value, ensure_ascii=False)
    except Exception:
        text = str(value)
    text = " ".join(text.split())
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


async def _cli_logger(level: str, message: str) -> None:
    text = message.strip()
    if not text:
        return
    prefix = {
        "info": "[INFO]",
        "error": "[ERROR]",
        "output": "[OUTPUT]",
    }.get(level, f"[{level.upper()}]")
    print(f"{prefix} {text}", flush=True)


def _cli_event_logger(event) -> None:
    action_id = getattr(event, "action_id", None)
    stage = f"S{event.stage}" if event.stage is not None else "S?"
    label = f"{action_id or stage}"

    if isinstance(event, ToolCallEvent):
        if event.phase == "pre":
            print(
                f"[{label}] [TOOL PRE] {event.tool_name} input={_compact(event.input)}",
                flush=True,
            )
        else:
            dur = f" {event.duration_ms:.0f}ms" if event.duration_ms is not None else ""
            err = f" error={event.error}" if event.error else ""
            print(
                f"[{label}] [TOOL POST] {event.tool_name}{dur}{err} output={_compact(event.output)}",
                flush=True,
            )
        return

    if isinstance(event, MCPToolEvent):
        dur = f" {event.duration_ms:.0f}ms" if event.duration_ms is not None else ""
        print(
            f"[{label}] [MCP] {event.server_name}.{event.tool_name}{dur} input={_compact(event.input)} output={_compact(event.output)}",
            flush=True,
        )
        return

    if isinstance(event, AgentMessageEvent):
        role = (event.role or "assistant").upper()
        for block in event.content_blocks:
            block_type = block.get("type")
            if block_type == "thinking":
                print(f"[{label}] [THINKING] {block.get('thinking', '').strip()}", flush=True)
            elif block_type == "text":
                print(f"[{label}] [{role}] {block.get('text', '').strip()}", flush=True)
        return

    if isinstance(event, SubagentEvent):
        print(
            f"[{label}] [SUBAGENT] {event.agent_name} {event.action}",
            flush=True,
        )
        return

    if isinstance(event, SystemEvent):
        meta = f" meta={_compact(event.metadata)}" if event.metadata else ""
        print(f"[{label}] [SYSTEM] {event.action}{meta}", flush=True)
        return

    if isinstance(event, ErrorEvent):
        print(
            f"[{label}] [ERROR EVENT] {event.error_type}: {event.message}",
            flush=True,
        )


def parse_args() -> tuple[argparse.Namespace, PipelineOrchestrator]:
    """Parse command line arguments."""
    orchestrator = PipelineOrchestrator()
    all_action_ids = orchestrator.action_registry.ids()

    parser = argparse.ArgumentParser(
        description="Helix — action-based local runtime",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Examples:
    # Run all enabled actions
    python main.py

    # List available actions
    python main.py --list-actions

    # Run specific actions
    python main.py --actions hello

    # Run with overall context prompt
    python main.py --actions hello --prompt "Research AI agent architectures"

Available actions: {", ".join(all_action_ids)}
        """,
    )

    parser.add_argument(
        "--actions",
        type=str,
        help="Comma-separated list of action IDs to run (default: all enabled actions)",
    )

    parser.add_argument(
        "--prompt",
        type=str,
        help="Overall context prompt injected into every action",
    )

    parser.add_argument(
        "--list-actions",
        action="store_true",
        help="List all available actions and exit",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without executing",
    )

    parser.add_argument(
        "--identity-debug",
        action="store_true",
        help="Run a standalone identity/persona debug action",
    )

    return parser.parse_args(), orchestrator


async def main() -> None:
    """Main entry point."""
    from logging_config import setup_logging

    setup_logging()
    args, orchestrator = parse_args()

    if args.list_actions:
        print("\nAvailable actions:\n")
        for action in orchestrator.action_registry.get_all():
            status = "" if action.enabled else " [disabled]"
            print(f"  {action.id:<16} {action.title}{status}")
            if action.description:
                print(f"  {'':16} {action.description}")
            print()
        return

    # Parse action IDs from --actions flag.
    action_ids: list[str] | None = None
    if args.actions:
        action_ids = [a.strip() for a in args.actions.split(",") if a.strip()]
        unknown = [a for a in action_ids if a not in orchestrator.action_registry]
        if unknown:
            print(f"[ERROR] Unknown action(s): {', '.join(unknown)}", file=sys.stderr)
            print(f"Available: {', '.join(orchestrator.action_registry.ids())}", file=sys.stderr)
            sys.exit(1)

    if args.dry_run:
        print("Dry run mode — no actions will be executed")
        if args.identity_debug:
            print("Would run: debug_identity")
        elif action_ids:
            print(f"Would run: {', '.join(action_ids)}")
        else:
            enabled = [a.id for a in orchestrator.action_registry.get_all() if a.enabled]
            print(f"Would run all enabled actions: {', '.join(enabled)}")
        if args.prompt:
            print(f"With prompt: {args.prompt}")
        return

    orchestrator.logger = _cli_logger
    orchestrator.event_logger = _cli_event_logger
    orchestrator.enable_sdk_hooks = False
    orchestrator.emit_tool_events_from_blocks = True

    if args.identity_debug:
        print("Running: debug_identity")
        action_result = await orchestrator.run_action("debug_identity")
        print(f"\nResult: {action_result}")
    elif action_ids or args.prompt:
        run_result = await orchestrator.run_actions(
            action_ids=action_ids,
            prompt=args.prompt,
        )
        print(f"\nResult: {run_result.model_dump_json(indent=2)}")
    else:
        run_result = await orchestrator.run_actions()
        print(f"\nResult: {run_result.model_dump_json(indent=2)}")


if __name__ == "__main__":
    asyncio.run(main())
