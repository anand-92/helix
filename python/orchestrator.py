"""Orchestrator for the Helix action-based runtime."""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import time
import traceback as tb_module
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

import structlog
from claude_agent_sdk import (
    AgentDefinition as SdkAgentDefinition,
)
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookCallback,
    HookContext,
    HookInput,
    HookMatcher,
    ResultMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import HookEvent, SyncHookJSONOutput, SystemPromptPreset

from agents import (
    HELLO_ACTION,
)
from config import (
    CWD,
    GEMINI_API_KEY,
    MEMORY_CONSOLIDATION_RUN_INTERVAL,
    MEMORY_CONSOLIDATION_SIMILARITY_THRESHOLD,
    MEMORY_DB_PATH,
    MEMORY_DEDUP_THRESHOLD,
    MEMORY_EMBED_DIM,
    MEMORY_EMBED_MODEL,
    MEMORY_ENABLED,
    MEMORY_FACT_CONFIRM_THRESHOLD,
    MEMORY_MAX_CANDIDATES,
    MEMORY_MAX_INJECTED,
    MEMORY_MEDIA_DIR,
    MEMORY_MEDIA_INLINE_MAX_BYTES,
    PROJECT_ROOT,
)
from events import (
    ActionDefinition,
    ActionRegistry,
    AgentMessageEvent,
    AnyEvent,
    ErrorEvent,
    MCPToolEvent,
    SubagentEvent,
    SystemEvent,
    ToolCallEvent,
)
from memory.service import MemoryService
from memory.tools import MEMORY_TOOL_NAMES, create_memory_mcp_server
from models import ActionResult, PipelineState, RunStatusResponse, UsageData
from utils import (
    ensure_directory,
)

logger = structlog.get_logger(__name__)

LogCallback = Callable[[str, str], Awaitable[None]]
EventCallback = Callable[[AnyEvent], None]

# ---------------------------------------------------------------------------
# System prompt — customize this for your agent's personality and behavior
# ---------------------------------------------------------------------------

AGENT_SYSTEM_PROMPT = """You are an AI agent running in the Helix.

You execute actions as part of a pipeline. Each action has a specific task.
Be helpful, concise, and focused on completing the task at hand.

Long-term memory:
You may have persistent memory across runs if memory is enabled.
Your action prompts will tell you when and how to use recall/remember/verify_fact.

This is a task pipeline. Make full use of the context window — be thorough but token-efficient.
Focus each action on its goal and move on.
"""


def _utcnow() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(tz=timezone.utc)


class PipelineOrchestrator:
    """Executes actions and emits structured events."""

    def __init__(
        self,
        cwd: Path = CWD,
        logger: LogCallback | None = None,
        event_logger: EventCallback | None = None,
        enable_sdk_hooks: bool = True,
        emit_tool_events_from_blocks: bool = False,
    ):
        self.cwd = cwd
        self.logger = logger
        self.event_logger = event_logger
        self.enable_sdk_hooks = enable_sdk_hooks
        self.emit_tool_events_from_blocks = emit_tool_events_from_blocks
        self._tool_use_lookup: dict[str, tuple[str, dict[str, object]]] = {}
        self._run_session_id: str | None = None
        self._run_client: ClaudeSDKClient | None = None
        self.state = PipelineState(status="idle")
        self.action_registry: ActionRegistry = ActionRegistry()
        self._last_event_ts: datetime | None = None
        self._memory_service: MemoryService | None = self._init_memory_service()
        self._register_actions()

    @staticmethod
    def _init_memory_service() -> MemoryService | None:
        """Create and return a MemoryService instance, or None if disabled.

        Memory is disabled by default. Set MEMORY_ENABLED=true and
        GEMINI_API_KEY to enable it.
        """
        if not MEMORY_ENABLED:
            logger.info("Memory disabled (set MEMORY_ENABLED=true to enable)")
            return None

        if not GEMINI_API_KEY:
            logger.info("GEMINI_API_KEY not set — memory service disabled")
            return None

        try:
            return MemoryService(
                db_path=MEMORY_DB_PATH,
                api_key=GEMINI_API_KEY,
                media_dir=MEMORY_MEDIA_DIR,
                dimensions=MEMORY_EMBED_DIM,
                max_candidates=MEMORY_MAX_CANDIDATES,
                max_injected=MEMORY_MAX_INJECTED,
                dedup_threshold=MEMORY_DEDUP_THRESHOLD,
                embed_model=MEMORY_EMBED_MODEL,
                inline_max_bytes=MEMORY_MEDIA_INLINE_MAX_BYTES,
                consolidation_similarity_threshold=MEMORY_CONSOLIDATION_SIMILARITY_THRESHOLD,
                consolidation_run_interval=MEMORY_CONSOLIDATION_RUN_INTERVAL,
                fact_confirm_threshold=MEMORY_FACT_CONFIRM_THRESHOLD,
            )
        except Exception:
            logger.warning(
                "MemoryService initialization failed — continuing without memory",
                exc_info=True,
            )
            return None

    def _register_actions(self) -> None:
        """Register all available actions in the action registry.

        To add a new action:
        1. Create python/agents/action_<name>.py with an AgentDefinition
        2. Import it in python/agents/__init__.py
        3. Add an ActionDefinition + handler here
        """

        def _late(method_name: str) -> Callable:
            async def _handler(prompt_override: str | None = None) -> str:
                return await getattr(self, method_name)(prompt_override=prompt_override)

            _handler.__name__ = method_name
            return _handler

        actions = [
            ActionDefinition(
                id="hello",
                title="Hello",
                description=HELLO_ACTION.description,
                handler=_late("_run_action_hello"),
            ),
        ]
        for action in actions:
            self.action_registry.register(action)

    @property
    def stage_registry(self) -> ActionRegistry:
        """Backward-compat alias for action_registry."""
        return self.action_registry

    # ------------------------------------------------------------------
    # Event emission helpers
    # ------------------------------------------------------------------

    def _ensure_monotonic_ts(self) -> datetime:
        now = _utcnow()
        if self._last_event_ts is not None and now < self._last_event_ts:
            now = self._last_event_ts
        self._last_event_ts = now
        return now

    def _emit_event(self, event: AnyEvent) -> None:
        if self.state.run_id and not event.run_id:
            event.run_id = self.state.run_id

        monotonic_ts = self._ensure_monotonic_ts()
        if event.timestamp < monotonic_ts:
            event.timestamp = monotonic_ts

        self.state.events.append(event.model_dump(mode="json"))
        if self.event_logger:
            with contextlib.suppress(Exception):
                self.event_logger(event)

    def _make_event_base(
        self,
        stage: int | None = None,
        action_id: str | None = None,
    ) -> dict:
        return {
            "run_id": self.state.run_id or "",
            "stage": stage if stage is not None else self.state.current_stage,
            "action_id": action_id if action_id is not None else self.state.current_action,
        }

    def _capture_usage(self, result_message: ResultMessage) -> None:
        usage_dict = getattr(result_message, "usage", None) or {}
        if isinstance(usage_dict, dict):
            input_tok = int(usage_dict.get("input_tokens", 0) or 0)
            output_tok = int(usage_dict.get("output_tokens", 0) or 0)
        else:
            input_tok = int(getattr(usage_dict, "input_tokens", 0) or 0)
            output_tok = int(getattr(usage_dict, "output_tokens", 0) or 0)

        from models import calculate_cost

        step_cost = calculate_cost(input_tok, output_tok)

        if not self.state.usage:
            self.state.usage = UsageData()
        self.state.usage.input_tokens += input_tok
        self.state.usage.output_tokens += output_tok
        self.state.usage.total_cost_usd += step_cost

    # ------------------------------------------------------------------
    # Hook builders
    # ------------------------------------------------------------------

    def _build_pre_compact_hook(self) -> HookCallback:
        orchestrator = self

        async def pre_compact_hook(
            hook_input: HookInput,
            tool_use_id: str | None,
            context: HookContext,
        ) -> SyncHookJSONOutput:
            if orchestrator._memory_service is None:
                return {}

            try:
                inp = cast(dict[str, Any], hook_input)
                messages: list[dict[str, Any]] = inp.get("messages", [])
                if not messages:
                    return {}

                text_parts: list[str] = []
                for msg in messages:
                    content = msg.get("content", "")
                    if isinstance(content, str) and content.strip():
                        text_parts.append(content.strip()[:200])
                    elif isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                text_parts.append(block["text"][:200])

                if not text_parts:
                    return {}

                summary = " | ".join(text_parts[:10])[:500]
                action_id = orchestrator.state.current_action or "compaction"

                await orchestrator._memory_service.write_from_action(
                    action_id=f"{action_id}_compacted",
                    result_text=summary,
                    run_id=orchestrator.state.run_id,
                )
            except Exception:
                logger.warning("pre_compact_memory_save_failed", exc_info=True)

            return {}

        return pre_compact_hook

    @staticmethod
    def _parse_mcp_tool(tool_name: str) -> tuple[str, str] | None:
        if not tool_name.startswith("mcp__"):
            return None
        parts = tool_name.split("__", 2)
        server = parts[1] if len(parts) > 1 else ""
        real_tool = parts[2] if len(parts) > 2 else tool_name
        return server, real_tool

    def _build_hooks(self) -> dict[HookEvent, list[HookMatcher]]:
        pre_times: dict[str, float] = {}
        orchestrator = self

        async def pre_tool_hook(
            hook_input: HookInput,
            tool_use_id: str | None,
            context: HookContext,
        ) -> SyncHookJSONOutput:
            inp = cast(dict[str, Any], hook_input)
            if tool_use_id:
                pre_times[tool_use_id] = time.monotonic()

            tool_name: str = inp.get("tool_name", "")
            tool_input: dict[str, Any] = inp.get("tool_input", {}) or {}
            stage = orchestrator.state.current_stage
            action_id = orchestrator.state.current_action

            mcp = orchestrator._parse_mcp_tool(tool_name)
            if mcp:
                server_name, real_tool = mcp
                event: AnyEvent = MCPToolEvent(
                    run_id=orchestrator.state.run_id or "",
                    stage=stage,
                    action_id=action_id,
                    server_name=server_name,
                    tool_name=real_tool,
                    input=tool_input if isinstance(tool_input, dict) else {},
                )
            else:
                event = ToolCallEvent(
                    run_id=orchestrator.state.run_id or "",
                    stage=stage,
                    action_id=action_id,
                    tool_name=tool_name,
                    input=tool_input if isinstance(tool_input, dict) else {},
                    phase="pre",
                )
            orchestrator._emit_event(event)
            return {}

        async def post_tool_hook(
            hook_input: HookInput,
            tool_use_id: str | None,
            context: HookContext,
        ) -> SyncHookJSONOutput:
            inp = cast(dict[str, Any], hook_input)
            tool_name: str = inp.get("tool_name", "")
            tool_input: dict[str, Any] = inp.get("tool_input", {}) or {}
            tool_response = inp.get("tool_response")
            stage = orchestrator.state.current_stage
            action_id = orchestrator.state.current_action

            duration_ms: float | None = None
            if tool_use_id and tool_use_id in pre_times:
                duration_ms = (time.monotonic() - pre_times.pop(tool_use_id)) * 1000

            output: dict | None = None
            if isinstance(tool_response, dict):
                output = tool_response
            elif tool_response is not None:
                output = {"result": str(tool_response)}

            error: str | None = None
            if isinstance(tool_response, dict) and (
                tool_response.get("is_error") or tool_response.get("error")
            ):
                error = str(
                    tool_response.get("error", tool_response.get("message", "Tool call failed"))
                )

            mcp = orchestrator._parse_mcp_tool(tool_name)
            if mcp:
                server_name, real_tool = mcp
                post_event: AnyEvent = MCPToolEvent(
                    run_id=orchestrator.state.run_id or "",
                    stage=stage,
                    action_id=action_id,
                    server_name=server_name,
                    tool_name=real_tool,
                    input=tool_input if isinstance(tool_input, dict) else {},
                    output=output,
                    duration_ms=duration_ms,
                )
            else:
                post_event = ToolCallEvent(
                    run_id=orchestrator.state.run_id or "",
                    stage=stage,
                    action_id=action_id,
                    tool_name=tool_name,
                    input=tool_input if isinstance(tool_input, dict) else {},
                    output=output,
                    duration_ms=duration_ms,
                    error=error,
                    phase="post",
                )
            orchestrator._emit_event(post_event)
            return {}

        subagent_start_times: dict[str, float] = {}

        async def subagent_start_hook(
            hook_input: HookInput,
            tool_use_id: str | None,
            context: HookContext,
        ) -> SyncHookJSONOutput:
            agent_id: str = cast(dict[str, Any], hook_input).get("agent_id", "")
            subagent_start_times[agent_id] = time.monotonic()
            orchestrator._emit_event(
                SubagentEvent(
                    run_id=orchestrator.state.run_id or "",
                    stage=orchestrator.state.current_stage,
                    action_id=orchestrator.state.current_action,
                    agent_name=agent_id,
                    action="start",
                )
            )
            return {}

        async def subagent_stop_hook(
            hook_input: HookInput,
            tool_use_id: str | None,
            context: HookContext,
        ) -> SyncHookJSONOutput:
            agent_id: str = cast(dict[str, Any], hook_input).get("agent_id", "")
            orchestrator._emit_event(
                SubagentEvent(
                    run_id=orchestrator.state.run_id or "",
                    stage=orchestrator.state.current_stage,
                    action_id=orchestrator.state.current_action,
                    agent_name=agent_id,
                    action="stop",
                )
            )
            subagent_start_times.pop(agent_id, None)
            return {}

        return {
            "PreToolUse": [HookMatcher(hooks=[pre_tool_hook])],
            "PostToolUse": [HookMatcher(hooks=[post_tool_hook])],
            "SubagentStart": [HookMatcher(hooks=[subagent_start_hook])],
            "SubagentStop": [HookMatcher(hooks=[subagent_stop_hook])],
            "PreCompact": [HookMatcher(hooks=[self._build_pre_compact_hook()])],
        }

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------

    async def _emit(self, message: str, level: str = "info") -> None:
        entry = message.strip()
        if entry:
            self.state.log_lines.append(f"[{level}] {entry}")
            if level == "output":
                self.state.output_lines.append(entry)
        if self.logger:
            await self.logger(level, message)

    # ------------------------------------------------------------------
    # Options
    # ------------------------------------------------------------------

    def _options(
        self,
        *,
        load_project_settings: bool = False,
    ) -> ClaudeAgentOptions:
        allowed = [
            "Skill",
            "Bash",
            "Read",
            "Write",
            "Edit",
            "MultiEdit",
            "Grep",
            "Glob",
            "LS",
            "TodoWrite",
            "Task",
        ]

        mcp_servers: dict = {}

        if self._memory_service is not None:
            try:
                mcp_servers["agent-memory"] = create_memory_mcp_server(self._memory_service)
                allowed.extend(MEMORY_TOOL_NAMES)
            except Exception:
                logger.warning("Failed to create memory MCP server", exc_info=True)

        return ClaudeAgentOptions(
            cwd=str(PROJECT_ROOT),
            permission_mode="bypassPermissions",
            allowed_tools=allowed,
            mcp_servers=mcp_servers if mcp_servers else {},
            hooks=self._build_hooks() if self.enable_sdk_hooks else {},
            system_prompt=SystemPromptPreset(
                type="preset", preset="claude_code", append=AGENT_SYSTEM_PROMPT
            ),
            setting_sources=["project"],
            settings=json.dumps({}),
            agents={},
        )

    # ------------------------------------------------------------------
    # SDK message stream
    # ------------------------------------------------------------------

    async def _ensure_shared_client(self) -> ClaudeSDKClient:
        if self._run_client is None:
            self._run_client = ClaudeSDKClient(options=self._options(load_project_settings=True))
            await self._run_client.connect()
        return self._run_client

    async def _close_shared_client(self) -> None:
        if self._run_client is not None:
            await self._run_client.disconnect()
            self._run_client = None

    async def _create_message_stream(
        self,
        prompt: str,
        *,
        load_project_settings: bool = False,
        resume_session: bool = True,
    ):
        if resume_session:
            client = await self._ensure_shared_client()
            await client.query(f"Task:\n{prompt}")
            async for message in client.receive_response():
                yield message
        else:
            async with ClaudeSDKClient(
                options=self._options(load_project_settings=load_project_settings)
            ) as client:
                await client.query(f"Task:\n{prompt}")
                async for message in client.receive_response():
                    yield message

    # ------------------------------------------------------------------
    # Session helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_session_id(message: object) -> str | None:
        sid = getattr(message, "session_id", None)
        if sid is None:
            data = getattr(message, "data", None) or {}
            if isinstance(data, dict):
                sid = data.get("session_id") or data.get("message_id")
        return sid

    # ------------------------------------------------------------------
    # Core agent action runner
    # ------------------------------------------------------------------

    async def _run_agent_action(
        self,
        action_id: str,
        execution_index: int,
        title: str,
        agent_name: str,
        prompt: str,
        *,
        global_prompt: str | None = None,
        load_project_settings: bool = False,
        resume_session: bool = True,
    ) -> str:
        run_id = self.state.run_id or ""
        self.state.current_action = action_id
        await self._emit(f"Starting action {action_id} ({execution_index}): {title}")

        self._emit_event(
            SystemEvent(
                run_id=run_id,
                stage=execution_index,
                action_id=action_id,
                action="stage_start",
                metadata={"title": title, "agent_name": agent_name, "action_id": action_id},
            )
        )

        self._emit_event(
            SubagentEvent(
                run_id=run_id,
                stage=execution_index,
                action_id=action_id,
                agent_name=agent_name,
                action="start",
            )
        )

        result_text = ""
        msg_count = 0
        self._tool_use_lookup.clear()

        await self._emit(f"Action {action_id} query starting")
        async for message in self._create_message_stream(
            prompt,
            load_project_settings=load_project_settings,
            resume_session=resume_session,
        ):
            msg_count += 1
            msg_type = type(message).__name__
            msg_detail = ""
            if msg_type == "SystemMessage":
                sid = self._extract_session_id(message)
                msg_detail = f" session_id={sid or '?'}"
                if sid:
                    self._run_session_id = sid
            await self._emit(f"Action {action_id} message #{msg_count}: {msg_type}{msg_detail}")

            if isinstance(message, AssistantMessage):
                await self._process_assistant_message(message, execution_index, run_id)

            elif isinstance(message, UserMessage):
                await self._process_user_message(message, execution_index, run_id)

            elif isinstance(message, ResultMessage):
                subtype = getattr(message, "subtype", "unknown")
                error_msg = getattr(message, "error_message", None)
                result_text = getattr(message, "result", "") or ""
                sid = getattr(message, "session_id", None)
                if sid:
                    self._run_session_id = sid
                if subtype == "error" or error_msg:
                    await self._emit(
                        f"Action {action_id} SDK error — subtype={subtype} error={error_msg}",
                        level="error",
                    )
                else:
                    await self._emit(
                        f"Action {action_id} result — subtype={subtype} length={len(result_text)}"
                    )
                self._capture_usage(message)

        await self._emit(f"Action {action_id} query finished — {msg_count} messages received")

        # --- Memory write ---
        if self._memory_service is not None:
            try:
                await self._memory_service.write_from_action(
                    action_id,
                    result_text,
                    run_id=self.state.run_id,
                )
            except Exception:
                logger.warning(
                    "memory_write_failed",
                    action_id=action_id,
                    exc_info=True,
                )

        self._emit_event(
            SubagentEvent(
                run_id=run_id,
                stage=execution_index,
                action_id=action_id,
                agent_name=agent_name,
                action="stop",
                result_summary=result_text[:500] if result_text else None,
            )
        )

        self._emit_event(
            SystemEvent(
                run_id=run_id,
                stage=execution_index,
                action_id=action_id,
                action="stage_complete",
                metadata={"title": title, "action_id": action_id},
            )
        )

        await self._emit(result_text, level="output")
        self.state.action_results.append(
            ActionResult(
                action_id=action_id,
                title=title,
                summary=result_text,
                execution_index=execution_index,
            )
        )
        return result_text

    async def _process_assistant_message(
        self,
        message: AssistantMessage,
        stage: int,
        run_id: str,
    ) -> None:
        action_id = self.state.current_action

        for block in message.content:
            if isinstance(block, TextBlock):
                self._emit_event(
                    AgentMessageEvent(
                        run_id=run_id,
                        stage=stage,
                        action_id=action_id,
                        content_blocks=[{"type": "text", "text": block.text}],
                        role="assistant",
                        model=getattr(message, "model", None),
                    )
                )

            elif isinstance(block, ThinkingBlock):
                self._emit_event(
                    AgentMessageEvent(
                        run_id=run_id,
                        stage=stage,
                        action_id=action_id,
                        content_blocks=[
                            {
                                "type": "thinking",
                                "thinking": block.thinking,
                                "signature": getattr(block, "signature", ""),
                            }
                        ],
                        role="assistant",
                        model=getattr(message, "model", None),
                    )
                )
            elif self.emit_tool_events_from_blocks and not self.enable_sdk_hooks:
                if isinstance(block, ToolUseBlock):
                    tool_name = block.name
                    tool_input = block.input if isinstance(block.input, dict) else {}
                    self._tool_use_lookup[block.id] = (tool_name, tool_input)
                    self._emit_event(
                        ToolCallEvent(
                            run_id=run_id,
                            stage=stage,
                            action_id=action_id,
                            tool_name=tool_name,
                            input=tool_input,
                            phase="pre",
                        )
                    )
                elif isinstance(block, ToolResultBlock):
                    tool_name = "unknown"
                    tool_input_result: dict[str, object] = {}
                    if block.tool_use_id in self._tool_use_lookup:
                        tool_name, tool_input_result = self._tool_use_lookup.pop(block.tool_use_id)

                    output: dict | None = None
                    if isinstance(block.content, str):
                        output = {"result": block.content}
                    elif block.content is not None:
                        output = {"result": str(block.content)}

                    error = "Tool call failed" if getattr(block, "is_error", False) else None

                    self._emit_event(
                        ToolCallEvent(
                            run_id=run_id,
                            stage=stage,
                            action_id=action_id,
                            tool_name=tool_name,
                            input=tool_input_result,
                            output=output,
                            error=error,
                            phase="post",
                        )
                    )

    async def _process_user_message(
        self,
        message: UserMessage,
        stage: int,
        run_id: str,
    ) -> None:
        content = message.content
        action_id = self.state.current_action

        if isinstance(content, str):
            summary = self._summarize_sdk_user_text(content)
            self._emit_event(
                AgentMessageEvent(
                    run_id=run_id,
                    stage=stage,
                    action_id=action_id,
                    content_blocks=[{"type": "text", "text": summary}],
                    role="user",
                )
            )
            return

        for block in content:
            if isinstance(block, TextBlock):
                summary = self._summarize_sdk_user_text(block.text)
                self._emit_event(
                    AgentMessageEvent(
                        run_id=run_id,
                        stage=stage,
                        action_id=action_id,
                        content_blocks=[{"type": "text", "text": summary}],
                        role="user",
                    )
                )
            elif (
                self.emit_tool_events_from_blocks
                and not self.enable_sdk_hooks
                and isinstance(block, ToolResultBlock)
            ):
                tool_name = "unknown"
                tool_input_user: dict[str, object] = {}
                if block.tool_use_id in self._tool_use_lookup:
                    tool_name, tool_input_user = self._tool_use_lookup.pop(block.tool_use_id)

                output: dict | None = None
                if isinstance(block.content, str):
                    output = {"result": block.content}
                elif block.content is not None:
                    output = {"result": str(block.content)}

                error = "Tool call failed" if getattr(block, "is_error", False) else None
                self._emit_event(
                    ToolCallEvent(
                        run_id=run_id,
                        stage=stage,
                        action_id=action_id,
                        tool_name=tool_name,
                        input=tool_input_user,
                        output=output,
                        error=error,
                        phase="post",
                    )
                )
            elif isinstance(block, ThinkingBlock):
                self._emit_event(
                    AgentMessageEvent(
                        run_id=run_id,
                        stage=stage,
                        action_id=action_id,
                        content_blocks=[
                            {
                                "type": "thinking",
                                "thinking": block.thinking,
                                "signature": getattr(block, "signature", ""),
                            }
                        ],
                        role="user",
                    )
                )

    @staticmethod
    def _summarize_sdk_user_text(text: str) -> str:
        stripped = text.strip()

        if stripped.startswith("---") and "allowed-tools:" in stripped:
            name_match = re.search(r"^name:\s*([^\n]+)$", stripped, flags=re.MULTILINE)
            if name_match:
                return f"SKILL LOADED: {name_match.group(1).strip()}"

        heading_match = re.search(r"^#\s+(.+)$", stripped, flags=re.MULTILINE)
        if heading_match and "skill" in stripped.lower() and len(stripped) > 400:
            heading = heading_match.group(1).strip()
            slug = heading.lower().replace(" ", "-")
            return f"SKILL LOADED: {slug}"

        return text

    # ------------------------------------------------------------------
    # Generic action runner
    # ------------------------------------------------------------------

    async def run_action(self, action_id: str, prompt_override: str | None = None) -> str:
        action_def = self.action_registry.get(action_id)
        if action_def is None:
            raise ValueError(f"Unknown action: {action_id!r}")

        execution_index = len(self.state.action_results) + 1
        self.state.current_action = action_id

        base_prompt = self._get_action_prompt(action_id)
        if prompt_override:
            prompt = f"{base_prompt}\n\nAdditional context:\n{prompt_override}"
        else:
            prompt = base_prompt

        return await self._run_agent_action(
            action_id=action_id,
            execution_index=execution_index,
            title=action_def.title,
            agent_name=action_id,
            prompt=prompt,
            global_prompt=prompt_override,
            load_project_settings=True,
            resume_session=action_def.resume_session,
        )

    _ACTION_PROMPTS: dict[str, str] = {}

    @classmethod
    def _init_action_prompts(cls) -> None:
        if cls._ACTION_PROMPTS:
            return
        cls._ACTION_PROMPTS = {
            "hello": HELLO_ACTION.prompt,
        }

    def _get_action_prompt(self, action_id: str) -> str:
        self._init_action_prompts()
        return self._ACTION_PROMPTS.get(action_id, "")

    # ------------------------------------------------------------------
    # Individual action handler methods
    # ------------------------------------------------------------------

    async def _run_action_hello(self, prompt_override: str | None = None) -> str:
        result = await self.run_action("hello", prompt_override)
        self.state.hello_message = result
        return result

    # ------------------------------------------------------------------
    # Multi-action runner
    # ------------------------------------------------------------------

    async def run_actions(
        self,
        action_ids: list[str] | None = None,
        prompt: str | None = None,
        action_prompts: dict[str, str] | None = None,
    ) -> RunStatusResponse:
        if action_ids is None:
            action_ids = [a.id for a in self.action_registry.get_all() if a.enabled]

        # Reorder: normal actions first, finalizers last
        normal: list[str] = []
        finalizer: list[str] = []
        for aid in action_ids:
            action_def = self.action_registry.get(aid)
            if action_def is not None and action_def.is_finalizer:
                finalizer.append(aid)
            else:
                normal.append(aid)
        action_ids = normal + finalizer

        preserved_run_id = self.state.run_id
        self.state = PipelineState(
            status="running",
            started_at=_utcnow(),
            run_id=preserved_run_id,
        )
        self._run_session_id = None
        self._run_client = None
        self._last_event_ts = None

        try:
            for action_id in action_ids:
                action_def = self.action_registry.get(action_id)
                if action_def is None:
                    await self._emit(f"Unknown action {action_id!r}, skipping", level="error")
                    continue

                overrides: list[str] = []
                if prompt:
                    overrides.append(prompt)
                if action_prompts and action_id in action_prompts:
                    overrides.append(action_prompts[action_id])
                override = "\n\n".join(overrides) if overrides else None

                await action_def.handler(override)

            self.state.status = "completed"
        except asyncio.CancelledError:
            self.state.status = "stopped"
            self._emit_event(
                SystemEvent(
                    run_id=self.state.run_id or "",
                    stage=len(self.state.action_results),
                    action_id=self.state.current_action,
                    action="run_stopped",
                    metadata={"reason": "user_requested"},
                )
            )
            await self._emit("Run cancelled by user", level="error")
            raise
        except Exception as exc:
            self.state.status = "failed"
            self.state.error = str(exc)
            await self._emit(f"Run failed: {exc}", level="error")
            self._emit_event(
                ErrorEvent(
                    run_id=self.state.run_id or "",
                    stage=len(self.state.action_results),
                    action_id=self.state.current_action,
                    error_type=type(exc).__name__,
                    message=str(exc),
                    traceback=tb_module.format_exc(),
                )
            )
        finally:
            await self._close_shared_client()
            self.state.completed_at = _utcnow()

        return self.snapshot()

    async def run_full_pipeline(self) -> RunStatusResponse:
        return await self.run_actions()

    def snapshot(self) -> RunStatusResponse:
        return RunStatusResponse(
            run_id=self.state.run_id,
            status=self.state.status,
            current_action=self.state.current_action,
            current_stage=self.state.current_stage,
            output=self.state.output_lines,
            logs=self.state.log_lines,
            actions=self.state.action_results,
            stages=self.state.action_results,
            error=self.state.error,
            events=list(self.state.events),
            usage=self.state.usage,
        )
