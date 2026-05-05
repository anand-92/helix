"""Structured event type system for the agent control center.

Defines:
  - EventType: literal union of all valid event type strings
  - BaseEvent: consistent envelope shared by all events
  - ToolCallEvent, AgentMessageEvent, SubagentEvent, MCPToolEvent,
    SystemEvent, ErrorEvent: typed event models inheriting BaseEvent
  - ActionDefinition: a single action descriptor
  - ActionRegistry: dynamic registry for registering/looking up actions
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any, Literal, Union, get_args

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ---------------------------------------------------------------------------
# EventType literal union
# ---------------------------------------------------------------------------

EventType = Literal["tool_call", "agent_message", "subagent", "mcp_tool", "system", "error"]

#: Tuple of all valid event type strings — use for exhaustiveness checks.
ALL_EVENT_TYPES: tuple[str, ...] = get_args(EventType)


# ---------------------------------------------------------------------------
# Base Event Envelope
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(tz=timezone.utc)


class BaseEvent(BaseModel):
    """Consistent envelope model shared by every structured event.

    Fields
    ------
    id          : unique UUID v4 string, auto-generated
    timestamp   : ISO-8601 UTC datetime, auto-generated
    event_type  : discriminator string from EventType
    run_id      : the active pipeline run this event belongs to
    stage       : execution index (1-based order the action actually ran in)
    action_id   : semantic action identifier (e.g. "hello", "deep_research")
    payload     : event-type-specific data dictionary
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=_utcnow)
    event_type: EventType
    run_id: str = ""
    stage: int | None = None
    action_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Typed Event Models
# ---------------------------------------------------------------------------


class ToolCallEvent(BaseEvent):
    """Emitted when the SDK fires a PreToolUse or PostToolUse hook.

    Extra fields
    ------------
    tool_name   : name of the tool being called
    input       : tool input arguments
    output      : tool result (None for pre-phase events)
    duration_ms : wall-clock time for the call (None for pre-phase)
    error       : error message if the call failed
    phase       : "pre" (before execution) or "post" (after)
    """

    event_type: Literal["tool_call"] = "tool_call"
    tool_name: str = ""
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] | None = None
    duration_ms: float | None = None
    error: str | None = None
    phase: Literal["pre", "post"] = "post"

    @model_validator(mode="after")
    def _sync_payload(self) -> ToolCallEvent:
        self.payload = {
            "tool_name": self.tool_name,
            "input": self.input,
            "output": self.output,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "phase": self.phase,
        }
        return self


class AgentMessageEvent(BaseEvent):
    """Emitted when the SDK yields an AssistantMessage.

    Extra fields
    ------------
    content_blocks : list of content block dicts (TextBlock, ThinkingBlock, etc.)
    role           : message role, typically "assistant"
    model          : model identifier (optional)
    """

    event_type: Literal["agent_message"] = "agent_message"
    content_blocks: list[dict[str, Any]] = Field(default_factory=list)
    role: str = "assistant"
    model: str | None = None

    @model_validator(mode="after")
    def _sync_payload(self) -> AgentMessageEvent:
        self.payload = {
            "content_blocks": self.content_blocks,
            "role": self.role,
            "model": self.model,
        }
        return self


class SubagentEvent(BaseEvent):
    """Emitted on sub-agent start/stop lifecycle.

    Extra fields
    ------------
    agent_name     : identifier for the sub-agent
    action         : "start" when dispatching, "stop" after completion
    result_summary : brief summary of sub-agent output (stop events only)
    """

    event_type: Literal["subagent"] = "subagent"
    agent_name: str = ""
    action: Literal["start", "stop"] = "start"
    result_summary: str | None = None

    @model_validator(mode="after")
    def _sync_payload(self) -> SubagentEvent:
        self.payload = {
            "agent_name": self.agent_name,
            "action": self.action,
            "result_summary": self.result_summary,
        }
        return self


class MCPToolEvent(BaseEvent):
    """Emitted when a tool call is routed through an MCP server.

    Extra fields
    ------------
    server_name : MCP server identifier (e.g. "memory")
    tool_name   : name of the MCP tool called
    input       : tool input arguments
    output      : tool result dict
    duration_ms : wall-clock call duration
    """

    event_type: Literal["mcp_tool"] = "mcp_tool"
    server_name: str = ""
    tool_name: str = ""
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] | None = None
    duration_ms: float | None = None

    @model_validator(mode="after")
    def _sync_payload(self) -> MCPToolEvent:
        self.payload = {
            "server_name": self.server_name,
            "tool_name": self.tool_name,
            "input": self.input,
            "output": self.output,
            "duration_ms": self.duration_ms,
        }
        return self


class SystemEvent(BaseEvent):
    """Emitted on stage/run lifecycle transitions.

    Extra fields
    ------------
    action   : one of stage_start | stage_complete | run_complete | run_stopped
    metadata : arbitrary key/value data about the transition
    """

    event_type: Literal["system"] = "system"
    action: Literal["stage_start", "stage_complete", "run_complete", "run_stopped"] = "stage_start"
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _sync_payload(self) -> SystemEvent:
        self.payload = {
            "action": self.action,
            "metadata": self.metadata,
        }
        return self


class ErrorEvent(BaseEvent):
    """Emitted when the pipeline encounters an unrecoverable error.

    Extra fields
    ------------
    error_type : exception class name or category string
    message    : human-readable error description
    traceback  : full traceback string (optional)
    """

    event_type: Literal["error"] = "error"
    error_type: str = ""
    message: str = ""
    traceback: str | None = None

    @model_validator(mode="after")
    def _sync_payload(self) -> ErrorEvent:
        self.payload = {
            "error_type": self.error_type,
            "message": self.message,
            "stage": self.stage,
            "traceback": self.traceback,
        }
        return self


# ---------------------------------------------------------------------------
# Union of all event types for type-safe handling
# ---------------------------------------------------------------------------

AnyEvent = Union[
    ToolCallEvent,
    AgentMessageEvent,
    SubagentEvent,
    MCPToolEvent,
    SystemEvent,
    ErrorEvent,
]


# ---------------------------------------------------------------------------
# ActionDefinition and ActionRegistry
# ---------------------------------------------------------------------------


class ActionDefinition(BaseModel):
    """Describes a single independent action.

    Fields
    ------
    id          : unique identifier string (e.g. "hello", "deep_research")
    title       : human-readable action name
    description : brief description for display in the UI
    handler     : async callable that executes the action
    enabled     : whether the action is currently active
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    id: str
    title: str
    description: str = ""
    handler: Callable[..., Any]
    enabled: bool = True
    is_finalizer: bool = False
    resume_session: bool = True


class ActionRegistry:
    """Registry of available actions. Insertion order is preserved.

    Actions are stored by ``id``. The registry provides ordered iteration
    in insertion order (the default execution order when running all actions).

    Example
    -------
    >>> registry = ActionRegistry()
    >>> registry.register(ActionDefinition(id="hello", title="Hello", handler=fn))
    >>> [a.id for a in registry]
    ['hello']
    """

    def __init__(self) -> None:
        self._actions: dict[str, ActionDefinition] = {}

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    def register(self, action: ActionDefinition) -> None:
        """Add or replace an action definition."""
        self._actions[action.id] = action

    def unregister(self, action_id: str) -> None:
        """Remove an action by id (no-op if not found)."""
        self._actions.pop(action_id, None)

    def clear(self) -> None:
        """Remove all registered actions."""
        self._actions.clear()

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def get_all(self) -> list[ActionDefinition]:
        """Return all actions in insertion order."""
        return list(self._actions.values())

    def get(self, action_id: str) -> ActionDefinition | None:
        """Return an action by id, or None if not found."""
        return self._actions.get(action_id)

    def ids(self) -> list[str]:
        """Return all action IDs in insertion order."""
        return list(self._actions.keys())

    # ------------------------------------------------------------------
    # Dunder helpers
    # ------------------------------------------------------------------

    def __iter__(self):
        return iter(self._actions.values())

    def __len__(self) -> int:
        return len(self._actions)

    def __contains__(self, action_id: str) -> bool:
        return action_id in self._actions

    def __repr__(self) -> str:
        return f"ActionRegistry({self.ids()!r})"


# ---------------------------------------------------------------------------
# Backward-compatible aliases
# ---------------------------------------------------------------------------

StageDefinition = ActionDefinition
StageRegistry = ActionRegistry
