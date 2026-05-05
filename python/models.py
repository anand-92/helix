"""Data models for Helix."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from events import (  # noqa: F401
    ActionDefinition,
    ActionRegistry,
    AgentMessageEvent,
    AnyEvent,
    BaseEvent,
    ErrorEvent,
    EventType,
    MCPToolEvent,
    StageDefinition,
    StageRegistry,
    SubagentEvent,
    SystemEvent,
    ToolCallEvent,
)

# Model pricing: $ per 1M tokens
MODEL_PRICING: dict[str, dict[str, float]] = {
    "MiniMax-2.7": {"input": 0.30, "output": 1.20},
    # Default pricing for unknown models (MiniMax as baseline)
    "default": {"input": 0.30, "output": 1.20},
}


def calculate_cost(input_tokens: int, output_tokens: int, model: str = "default") -> float:
    """Calculate cost in USD based on token counts and model pricing.

    The SDK's total_cost_usd is incorrect for non-Claude models, so we
    calculate our own using known pricing.
    """
    pricing = MODEL_PRICING.get(model, MODEL_PRICING["default"])
    input_cost = (input_tokens / 1_000_000) * pricing["input"]
    output_cost = (output_tokens / 1_000_000) * pricing["output"]
    return input_cost + output_cost


class UsageData(BaseModel):
    """Token usage and cost data captured from SDK ResultMessage."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_cost_usd: float = 0.0


class AgentLogEntry(BaseModel):
    """A single timestamped log entry."""

    timestamp: datetime = Field(default_factory=datetime.now)
    message: str
    level: Literal["info", "error", "output"] = "info"


class ActionResult(BaseModel):
    """Result data for one executed action."""

    action_id: str
    title: str
    summary: str
    execution_index: int = 0
    data: dict[str, Any] | None = None
    completed_at: datetime = Field(default_factory=datetime.now)


# Backward-compatible alias
StageResult = ActionResult


class PipelineState(BaseModel):
    """Current state of one agent run."""

    run_id: str | None = None
    status: Literal["idle", "running", "completed", "failed", "stopped"] = "idle"
    current_action: str | None = None
    action_results: list[ActionResult] = Field(default_factory=list)
    output_lines: list[str] = Field(default_factory=list)
    log_lines: list[str] = Field(default_factory=list)
    error: str | None = None
    hello_message: str | None = None
    # Structured event log — populated by event capture.
    events: list[dict[str, Any]] = Field(default_factory=list)
    # Token usage and cost data accumulated across all actions.
    usage: UsageData | None = None
    # Run lifecycle timestamps.
    started_at: datetime | None = None
    completed_at: datetime | None = None

    @property
    def current_stage(self) -> int | None:
        """Backward-compat: execution index of current action."""
        if self.current_action is None:
            return None
        for r in self.action_results:
            if r.action_id == self.current_action:
                return r.execution_index
        return len(self.action_results) + 1

    @property
    def stage_results(self) -> list[ActionResult]:
        """Backward-compat alias for action_results."""
        return self.action_results


class RunStartResponse(BaseModel):
    """Response returned when a run is started."""

    run_id: str
    status: str


class RunStatusResponse(BaseModel):
    """Aggregated run state returned to the UI."""

    run_id: str | None = None
    status: str
    current_action: str | None = None
    current_stage: int | None = None  # backward-compat: execution index
    output: list[str] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)
    actions: list[ActionResult] = Field(default_factory=list)
    stages: list[ActionResult] = Field(default_factory=list)  # backward-compat alias
    error: str | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    usage: UsageData | None = None


class RunHistorySummary(BaseModel):
    """Summary of a completed pipeline run for the /runs/history endpoint."""

    run_id: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    stage_count: int = 0
    usage: UsageData | None = None
