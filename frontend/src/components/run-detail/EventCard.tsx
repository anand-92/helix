/**
 * Event card components for the Run Detail timeline.
 *
 * Each backend event type has a distinct visual treatment:
 *   - SystemEvent     : stage transitions with icon
 *   - ToolCallEvent   : tool name + status badge
 *   - AgentMessageEvent : rich markdown/thinking/terminal rendering
 *   - SubagentEvent   : agent name + start/stop status
 *   - MCPToolEvent    : server + tool name
 *   - ErrorEvent      : red-styled error card
 */

import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Flag,
  Network,
  PlayCircle,
  StopCircle,
  Terminal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMemoryMcpServer } from '@/lib/memory-tool-detection'
import { formatRelativeTime } from '@/lib/relative-time'
import { getEventStageTitle } from '@/lib/run-display'
import type { RunEvent } from '@/types/run'
import CopyButton from '@/components/CopyButton'
import ToolCallCard from './ToolCallCard'
import AgentMessageCard from './AgentMessageCard'

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

/** Small monospace timestamp shown on every card */
function Timestamp({ iso }: { iso: string }) {
  return (
    <time
      dateTime={iso}
      className="text-[10px] text-muted-foreground/50 font-mono tabular-nums shrink-0"
      data-testid="event-timestamp"
    >
      {formatRelativeTime(iso)}
    </time>
  )
}

/** Colored badge showing which subagent emitted this event */
function SubagentBadge({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0 text-[10px] font-medium text-indigo-400"
      data-testid="subagent-badge"
    >
      <Bot className="mr-0.5 size-2.5" aria-hidden="true" />
      {name}
    </span>
  )
}

/** Duration badge */
function DurationBadge({ ms }: { ms: number }) {
  const label = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
  return (
    <span
      className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-1.5 py-0 text-[10px] font-mono text-muted-foreground/70"
      data-testid="duration-badge"
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract optional subagent name from payload for context badge */
function getSubagentName(payload: Record<string, unknown>): string | null {
  const name = payload.subagent_name
  return typeof name === 'string' && name.length > 0 ? name : null
}

// ---------------------------------------------------------------------------
// SystemEvent card
// ---------------------------------------------------------------------------

const SYSTEM_ACTION_CONFIG: Record<
  string,
  { icon: React.ReactNode; label: string; colorClass: string }
> = {
  stage_start: {
    icon: <PlayCircle className="size-3.5" aria-hidden="true" />,
    label: 'Stage started',
    colorClass: 'text-blue-400 border-blue-500/20 bg-blue-500/5',
  },
  stage_complete: {
    icon: <CheckCircle2 className="size-3.5" aria-hidden="true" />,
    label: 'Stage completed',
    colorClass: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
  },
  run_complete: {
    icon: <Flag className="size-3.5" aria-hidden="true" />,
    label: 'Run completed',
    colorClass: 'text-blue-400 border-blue-500/20 bg-blue-500/5',
  },
  run_stopped: {
    icon: <StopCircle className="size-3.5" aria-hidden="true" />,
    label: 'Run stopped',
    colorClass: 'text-amber-400 border-amber-500/20 bg-amber-500/5',
  },
}

function SystemEventCard({ event }: { event: RunEvent }) {
  const action = (event.payload.action as string) ?? 'unknown'
  const config = SYSTEM_ACTION_CONFIG[action] ?? {
    icon: <Activity className="size-3.5" aria-hidden="true" />,
    label: action,
    colorClass: 'text-muted-foreground border-border/40 bg-muted/10',
  }
  const stageTitle = getEventStageTitle(event)
  const stageSuffix = stageTitle
    ? event.stage != null
      ? ` — Stage ${event.stage} · ${stageTitle}`
      : ` — ${stageTitle}`
    : event.stage != null
      ? ` — Stage ${event.stage}`
      : ''

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
        config.colorClass,
      )}
      data-testid="event-card-system"
      data-event-id={event.id}
    >
      <span className="shrink-0">{config.icon}</span>
      <span className="font-medium">
        {config.label}
        {stageSuffix}
      </span>
      <div className="ml-auto">
        <Timestamp iso={event.timestamp} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ToolCallEvent card — delegated to rich ToolCallCard component
// ---------------------------------------------------------------------------
// ToolCallEventCard is intentionally removed; EventCard uses ToolCallCard directly.

// ---------------------------------------------------------------------------
// AgentMessageEvent — delegated to AgentMessageCard (rich rendering)
// ---------------------------------------------------------------------------
// AgentMessageEventCard is intentionally removed; EventCard uses AgentMessageCard directly.

// ---------------------------------------------------------------------------
// SubagentEvent card
// ---------------------------------------------------------------------------

const SUBAGENT_ACTION_CONFIG: Record<string, { colorClass: string; label: string }> = {
  start: {
    colorClass: 'border-cyan-500/20 bg-cyan-500/5 text-cyan-400',
    label: 'started',
  },
  stop: {
    colorClass: 'border-amber-500/20 bg-amber-500/5 text-amber-400',
    label: 'finished',
  },
}

function SubagentEventCard({ event }: { event: RunEvent }) {
  const agentName = (event.payload.agent_name as string) ?? 'agent'
  const action = (event.payload.action as string) ?? 'start'
  const activityTitle = getEventStageTitle(event) ?? agentName
  const config = SUBAGENT_ACTION_CONFIG[action] ?? {
    colorClass: 'border-border/40 bg-muted/10 text-muted-foreground',
    label: action,
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
        config.colorClass,
      )}
      data-testid="event-card-subagent"
      data-event-id={event.id}
    >
      <Bot className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">
        Stage activity {config.label} — <span className="font-mono">{activityTitle}</span>
      </span>
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <SubagentBadge name={activityTitle} />
        <Timestamp iso={event.timestamp} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MCPToolEvent card
// ---------------------------------------------------------------------------

function MCPToolEventCard({ event }: { event: RunEvent }) {
  const serverName = (event.payload.server_name as string) ?? 'unknown'
  const toolName = (event.payload.tool_name as string) ?? 'unknown'
  const durationMs = event.payload.duration_ms as number | null | undefined
  const subagentName = getSubagentName(event.payload)
  const isMemoryTool = isMemoryMcpServer(serverName)

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
        isMemoryTool ? 'memory-tool-card' : 'border-teal-500/20 bg-teal-500/5',
      )}
      data-testid="event-card-mcp-tool"
      data-event-id={event.id}
      data-is-memory={isMemoryTool ? 'true' : undefined}
    >
      <Network
        className={cn('size-3.5 shrink-0', isMemoryTool ? 'text-fuchsia-300' : 'text-teal-400')}
        aria-hidden="true"
      />
      <span className={cn('font-medium', isMemoryTool ? 'text-foreground/85' : 'text-teal-300/80')}>
        <span className={cn('font-mono', isMemoryTool ? 'text-fuchsia-200/85' : undefined)}>
          {serverName}
        </span>
        <span className={cn('mx-1', isMemoryTool ? 'text-fuchsia-300/50' : 'text-teal-400/50')}>
          /
        </span>
        <span className={cn('font-mono', isMemoryTool ? 'memory-rainbow-text' : undefined)}>
          {toolName}
        </span>
      </span>
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {isMemoryTool && (
          <span
            className="memory-rainbow-badge inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium"
            data-testid="memory-badge"
          >
            memory
          </span>
        )}
        {subagentName && <SubagentBadge name={subagentName} />}
        {durationMs != null && <DurationBadge ms={durationMs} />}
        <Timestamp iso={event.timestamp} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ErrorEvent card
// ---------------------------------------------------------------------------

function ErrorEventCard({ event }: { event: RunEvent }) {
  const errorType = (event.payload.error_type as string) ?? 'Error'
  const message = (event.payload.message as string) ?? 'An error occurred'
  const subagentName = getSubagentName(event.payload)

  return (
    <div
      className="rounded-md border border-red-500/40 bg-red-500/8 px-3 py-2 text-xs"
      data-testid="event-card-error"
      data-event-id={event.id}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-3.5 shrink-0 text-red-400" aria-hidden="true" />
        <span className="font-semibold text-red-300">{errorType}</span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {subagentName && <SubagentBadge name={subagentName} />}
          <CopyButton text={message} label="Copy error message" />
          <Timestamp iso={event.timestamp} />
        </div>
      </div>
      <p className="mt-1.5 text-red-400/80 break-all pl-5">{message}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fallback card for unknown event types
// ---------------------------------------------------------------------------

function FallbackEventCard({ event }: { event: RunEvent }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/10 px-3 py-2 text-xs text-muted-foreground/60"
      data-testid="event-card-unknown"
      data-event-id={event.id}
    >
      <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-mono">{event.event_type}</span>
      <div className="ml-auto">
        <Timestamp iso={event.timestamp} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

interface EventCardProps {
  event: RunEvent
}

/**
 * Renders the appropriate card component based on event type.
 */
export default function EventCard({ event }: EventCardProps) {
  switch (event.event_type) {
    case 'system':
      return <SystemEventCard event={event} />
    case 'tool_call':
      return <ToolCallCard event={event} />
    case 'agent_message':
      return <AgentMessageCard event={event} />
    case 'subagent':
      return <SubagentEventCard event={event} />
    case 'mcp_tool':
      return <MCPToolEventCard event={event} />
    case 'error':
      return <ErrorEventCard event={event} />
    default:
      return <FallbackEventCard event={event} />
  }
}
