/**
 * agent-tree.ts — Pure utility for building a nested AgentNode tree
 * from raw RunEvent arrays.
 *
 * The tree structure mirrors the orchestrator's agent dispatch hierarchy:
 *   - Root node: "Orchestrator" (always present, depth 0)
 *   - Child nodes: one per SubagentEvent start/stop pair (depth 1)
 *
 * Metrics per node:
 *   - toolCallCount  : count of post-phase tool_call events for that stage
 *   - durationMs     : wall-clock time between subagent start and stop events
 *   - costUsd        : total run cost for root; null for children (not tracked per-agent)
 */

import type { RunEvent, RunUsage } from '@/types/run'

// ---------------------------------------------------------------------------
// AgentNode type
// ---------------------------------------------------------------------------

export type AgentStatus = 'idle' | 'active' | 'completed'

export interface AgentNode {
  /** Unique stable identifier for this node (used as collapse key). */
  id: string
  /** Display name of the agent. */
  agentName: string
  /** Pipeline stage number, or null for the root orchestrator. */
  stage: number | null
  /** Whether the agent is currently running, has finished, or has not started yet. */
  status: AgentStatus
  /** ISO timestamp when the agent started (from SubagentEvent start). */
  startedAt: Date | null
  /** ISO timestamp when the agent stopped (from SubagentEvent stop), or null if still running. */
  completedAt: Date | null
  /** Wall-clock duration in milliseconds, or null if agent has not stopped yet. */
  durationMs: number | null
  /** Number of post-phase tool_call events during this agent's execution. */
  toolCallCount: number
  /** Total run cost in USD for the root node; null for child nodes. */
  costUsd: number | null
  /** Brief result summary from the SubagentEvent stop payload, if available. */
  resultSummary: string | null
  /** Child agent nodes (subagents dispatched by this agent). */
  children: AgentNode[]
  /** Nesting depth (0 = root). */
  depth: number
}

// ---------------------------------------------------------------------------
// buildAgentTree
// ---------------------------------------------------------------------------

/**
 * Build an AgentNode tree from a flat array of RunEvents.
 *
 * @param events   - Flat array of events from the store (any order).
 * @param usage    - Optional run-level usage/cost data for the root node.
 * @param isActive - Whether the run is currently active (affects status derivation).
 * @returns        The root AgentNode with child nodes populated.
 */
export function buildAgentTree(
  events: RunEvent[],
  usage?: RunUsage | null,
  isActive?: boolean,
): AgentNode {
  // Sort events chronologically for deterministic processing.
  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )

  // ------------------------------------------------------------------
  // Build child nodes from SubagentEvent pairs
  // ------------------------------------------------------------------
  const startEvents = sorted.filter(
    (e) => e.event_type === 'subagent' && e.payload.action === 'start',
  )

  const children: AgentNode[] = startEvents.map((startEvent) => {
    const agentName =
      typeof startEvent.payload.agent_name === 'string' ? startEvent.payload.agent_name : 'agent'
    const stage = startEvent.stage
    const nodeId = `${agentName}-${stage ?? 'null'}`

    // Find the matching stop event (same agent_name + stage, action=stop).
    const stopEvent = sorted.find(
      (e) =>
        e.event_type === 'subagent' &&
        e.payload.action === 'stop' &&
        (e.payload.agent_name as string) === agentName &&
        e.stage === stage,
    )

    // Count post-phase tool_call events for this stage.
    const toolCallCount = sorted.filter(
      (e) =>
        e.event_type === 'tool_call' &&
        e.stage === stage &&
        // Accept post-phase events (or events with no phase field for backward compat).
        (e.payload.phase === 'post' || e.payload.phase == null),
    ).length

    const startedAt = new Date(startEvent.timestamp)
    const completedAt = stopEvent ? new Date(stopEvent.timestamp) : null
    const durationMs = completedAt !== null ? completedAt.getTime() - startedAt.getTime() : null

    let childStatus: AgentStatus
    if (stopEvent) {
      childStatus = 'completed'
    } else if (isActive) {
      childStatus = 'active'
    } else {
      childStatus = 'idle'
    }

    return {
      id: nodeId,
      agentName,
      stage,
      status: childStatus,
      startedAt,
      completedAt,
      durationMs,
      toolCallCount,
      costUsd: null, // Not tracked per-agent by the backend.
      resultSummary:
        typeof stopEvent?.payload.result_summary === 'string'
          ? stopEvent.payload.result_summary
          : null,
      children: [],
      depth: 1,
    }
  })

  // ------------------------------------------------------------------
  // Build root node
  // ------------------------------------------------------------------

  // Root tool call count is the sum of all child tool calls plus any
  // tool calls that don't belong to a known subagent stage.
  const childStages = new Set(children.map((c) => c.stage))
  const orphanToolCalls = sorted.filter(
    (e) =>
      e.event_type === 'tool_call' &&
      (e.payload.phase === 'post' || e.payload.phase == null) &&
      (e.stage == null || !childStages.has(e.stage)),
  ).length

  const rootToolCallCount = children.reduce((sum, c) => sum + c.toolCallCount, 0) + orphanToolCalls

  // Root start time: first event's timestamp.
  const rootStartedAt = sorted.length > 0 ? new Date(sorted[0].timestamp) : null

  // Root end time: last event's timestamp when not active.
  const rootCompletedAt =
    !isActive && sorted.length > 0 ? new Date(sorted[sorted.length - 1].timestamp) : null

  const rootDurationMs =
    rootStartedAt && rootCompletedAt ? rootCompletedAt.getTime() - rootStartedAt.getTime() : null

  // Root status: active when run is active, completed when run is done.
  let rootStatus: AgentStatus
  if (isActive) {
    rootStatus = 'active'
  } else if (sorted.length > 0) {
    rootStatus = 'completed'
  } else {
    rootStatus = 'idle'
  }

  const root: AgentNode = {
    id: 'root',
    agentName: 'Orchestrator',
    stage: null,
    status: rootStatus,
    startedAt: rootStartedAt,
    completedAt: rootCompletedAt,
    durationMs: rootDurationMs,
    toolCallCount: rootToolCallCount,
    costUsd: usage?.total_cost_usd ?? null,
    resultSummary: null,
    children,
    depth: 0,
  }

  return root
}

// ---------------------------------------------------------------------------
// Formatting helpers (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds as a human-readable string.
 * Returns "—" when the duration is null (agent has not stopped yet).
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Format a cost in USD as a human-readable string.
 * Returns "—" when cost is null.
 */
export function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return `$${usd.toFixed(6)}`
  return `$${usd.toFixed(4)}`
}
