/**
 * Log viewer utility functions — pure helpers for filtering and summarising
 * RunEvent objects.
 *
 * These are extracted from LogViewer.tsx to satisfy the react-refresh/only-export-components
 * ESLint rule (component files should only export components).
 */

import type { RunEvent } from '@/types/run'
import { getEventStageTitle } from '@/lib/run-display'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid event types, in display order */
export const EVENT_TYPES = [
  'tool_call',
  'agent_message',
  'subagent',
  'mcp_tool',
  'system',
  'error',
] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'error' | 'output'

function getTextPreview(text: string, maxLength = 120): string {
  return text.slice(0, maxLength)
}

function getSystemEventSummary(event: RunEvent): string {
  const action = (event.payload.action as string | undefined) ?? 'system'
  const stageTitle = getEventStageTitle(event)

  if (event.stage != null && stageTitle) {
    return `${action} — stage ${event.stage} (${stageTitle})`
  }

  if (event.stage != null) {
    return `${action} — stage ${event.stage}`
  }

  return action
}

function getToolCallEventSummary(event: RunEvent): string {
  const toolName = (event.payload.tool_name as string | undefined) ?? 'unknown'
  const hasError = Boolean(event.payload.error || event.payload.is_error)

  return hasError ? `${toolName} (error)` : toolName
}

function getAgentMessageSummary(event: RunEvent): string {
  const blocks =
    (event.payload.content_blocks as Array<{ type: string; text?: string }> | undefined) ?? []
  const textBlock = blocks.find((block) => block.type === 'text')

  if (!textBlock?.text) {
    return 'agent message'
  }

  return getTextPreview(textBlock.text)
}

function getSubagentEventSummary(event: RunEvent): string {
  const agentName = (event.payload.agent_name as string | undefined) ?? 'agent'
  const action = (event.payload.action as string | undefined) ?? 'start'
  const activityTitle = getEventStageTitle(event) ?? agentName

  return `stage activity ${action} — ${activityTitle}`
}

function getMcpToolEventSummary(event: RunEvent): string {
  const server = (event.payload.server_name as string | undefined) ?? ''
  const tool = (event.payload.tool_name as string | undefined) ?? ''

  return `${server}/${tool}`
}

function getErrorEventSummary(event: RunEvent): string {
  const message = (event.payload.message as string | undefined) ?? 'error'
  return getTextPreview(message)
}

// ---------------------------------------------------------------------------
// getEventLevel
// ---------------------------------------------------------------------------

/**
 * Determine the log level for a run event.
 *
 * error  → any `error` event type, or a `tool_call` with an error payload
 * output → `agent_message` events; `system` stage_complete / run_complete
 * info   → everything else
 */
export function getEventLevel(event: RunEvent): LogLevel {
  if (event.event_type === 'error') return 'error'

  if (event.event_type === 'tool_call') {
    if (event.payload.error || event.payload.is_error) return 'error'
  }

  if (event.event_type === 'agent_message') return 'output'

  if (event.event_type === 'system') {
    const action = event.payload.action as string | undefined
    if (action === 'stage_complete' || action === 'run_complete') return 'output'
  }

  return 'info'
}

// ---------------------------------------------------------------------------
// getEventSummary
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable summary string from a run event.
 * Truncates long text to 120 characters.
 */
export function getEventSummary(event: RunEvent): string {
  switch (event.event_type) {
    case 'system':
      return getSystemEventSummary(event)

    case 'tool_call':
      return getToolCallEventSummary(event)

    case 'agent_message':
      return getAgentMessageSummary(event)

    case 'subagent':
      return getSubagentEventSummary(event)

    case 'mcp_tool':
      return getMcpToolEventSummary(event)

    case 'error':
      return getErrorEventSummary(event)

    default:
      return event.event_type
  }
}

// ---------------------------------------------------------------------------
// filterEvents
// ---------------------------------------------------------------------------

/**
 * Apply type filters and keyword search to an array of events.
 *
 * @param events        - Source events (unsorted)
 * @param activeFilters - Set of EventType strings; empty = no filter (show all)
 * @param searchQuery   - Keyword; empty = no search filter
 */
export function filterEvents(
  events: RunEvent[],
  activeFilters: Set<string>,
  searchQuery: string,
): RunEvent[] {
  const q = searchQuery.trim().toLowerCase()

  return events.filter((event) => {
    // Type filter (OR logic)
    if (activeFilters.size > 0 && !activeFilters.has(event.event_type)) {
      return false
    }

    // Keyword search (against summary + event_type)
    if (q) {
      const summary = getEventSummary(event).toLowerCase()
      const typeStr = event.event_type.toLowerCase()
      if (!summary.includes(q) && !typeStr.includes(q)) return false
    }

    return true
  })
}
