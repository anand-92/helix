/**
 * MCPPanel — MCP usage panel for the Run Detail view.
 *
 * Shows all MCP servers that were used during a run (derived from mcp_tool events).
 *
 * Features:
 *   - Server list: name, connection status badge, tool count
 *   - Expandable: click a server to reveal its tool list
 *   - Per-tool: call count badge, last-used relative timestamp
 *   - Empty state: "No MCP activity" when no mcp_tool events exist
 *   - Real-time updates: re-derives data from incoming events
 */

import { useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight, Network, Wrench } from 'lucide-react'
import MotionCollapse from '@/components/MotionCollapse'
import { Skeleton } from '@/components/ui/skeleton'
import { getListAnimationConfig } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { buildMCPData } from '@/lib/mcp-panel'
import type { MCPServerInfo } from '@/lib/mcp-panel'
import type { RunEvent } from '@/types/run'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MCPPanelProps {
  /** All events for the current/historical run. */
  events: RunEvent[]
  /** Whether the panel is waiting for async data. */
  loading?: boolean
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function MCPPanelEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center h-full min-h-[120px] gap-3 text-center px-6 py-8"
      data-testid="mcp-panel-empty"
    >
      <Network className="size-5 text-muted-foreground/30" aria-hidden="true" />
      <p className="text-xs text-muted-foreground/60 max-w-[180px] leading-relaxed">
        No MCP activity — tool calls will appear when MCP servers are invoked
      </p>
    </div>
  )
}

function MCPPanelSkeleton() {
  return (
    <div className="overflow-y-auto h-full py-1" data-testid="mcp-panel-skeleton">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="rounded-md border border-border/30 bg-card/40 px-3 py-2 mx-2 my-2"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
  serverName,
}: {
  status: MCPServerInfo['status']
  serverName: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium',
        status === 'active'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-border/40 bg-muted/20 text-muted-foreground/50',
      )}
      data-testid={`mcp-status-${serverName}`}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/30',
        )}
        aria-hidden="true"
      />
      {status === 'active' ? 'active' : 'inactive'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// MCPToolRow — single tool entry inside an expanded server
// ---------------------------------------------------------------------------

interface MCPToolRowProps {
  toolName: string
  callCount: number
  lastUsed: string | null
}

function MCPToolRow({ toolName, callCount, lastUsed }: MCPToolRowProps) {
  return (
    <div
      className="interactive-row flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/10"
      data-testid={`mcp-tool-${toolName}`}
    >
      {/* Indent guide line */}
      <span className="absolute left-[28px] top-0 bottom-0 w-px bg-border/20" aria-hidden="true" />

      {/* Tool icon */}
      <Wrench className="size-3 shrink-0 text-teal-400/60" aria-hidden="true" />

      {/* Tool name */}
      <span className="font-mono truncate flex-1">{toolName}</span>

      {/* Badges pushed right */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Call count badge */}
        <span
          className="inline-flex items-center rounded border border-teal-500/20 bg-teal-500/10 px-1 py-0 text-[10px] font-mono font-medium text-teal-300/80 tabular-nums"
          data-testid={`mcp-call-count-${toolName}`}
        >
          {callCount}×
        </span>

        {/* Last used timestamp */}
        {lastUsed && (
          <time
            dateTime={lastUsed}
            className="text-[10px] text-muted-foreground/40 font-mono tabular-nums"
            data-testid={`mcp-last-used-${toolName}`}
          >
            {formatRelativeTime(lastUsed)}
          </time>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MCPServerRow — expandable server row
// ---------------------------------------------------------------------------

interface MCPServerRowProps {
  server: MCPServerInfo
  isExpanded: boolean
  onToggle: () => void
}

function MCPServerRow({ server, isExpanded, onToggle }: MCPServerRowProps) {
  const { serverName, status, toolCount, tools } = server

  return (
    <div>
      {/* Server header row — click to expand/collapse */}
      <button
        type="button"
        className="interactive-row relative w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${serverName} tools`}
        data-testid={`mcp-server-${serverName}`}
      >
        {/* Expand/collapse chevron */}
        <span className="shrink-0 text-muted-foreground/50">
          {isExpanded ? (
            <ChevronDown className="size-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3" aria-hidden="true" />
          )}
        </span>

        {/* Network icon */}
        <Network className="size-3.5 shrink-0 text-teal-400/70" aria-hidden="true" />

        {/* Server name */}
        <span className="font-mono font-medium text-foreground/90 truncate flex-1">
          {serverName}
        </span>

        {/* Badges pushed to right */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Status badge */}
          <StatusBadge status={status} serverName={serverName} />

          {/* Tool count badge */}
          <span
            className="inline-flex items-center rounded border border-border/30 bg-muted/20 px-1 py-0 text-[10px] font-mono text-muted-foreground/60 tabular-nums"
            data-testid={`mcp-tool-count-${serverName}`}
          >
            {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
          </span>
        </div>
      </button>

      {/* Tool list — only shown when expanded */}
      <MotionCollapse open={isExpanded} className="relative" testId={`mcp-tool-list-${serverName}`}>
        <div className="relative">
          {tools.map((tool) => (
            <MCPToolRow
              key={tool.toolName}
              toolName={tool.toolName}
              callCount={tool.callCount}
              lastUsed={tool.lastUsed}
            />
          ))}
        </div>
      </MotionCollapse>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MCPPanel — root component
// ---------------------------------------------------------------------------

export default function MCPPanel({ events, loading = false }: MCPPanelProps) {
  // Track which servers are expanded (by serverName)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const shouldReduceMotion = useReducedMotion() ?? false

  // Derive MCP data from events — updates reactively on prop change
  const servers = useMemo(() => buildMCPData(events), [events])
  const serverAnimation = getListAnimationConfig(servers.length, shouldReduceMotion)

  // Show empty state when no MCP activity
  if (loading) {
    return <MCPPanelSkeleton />
  }

  if (servers.length === 0) {
    return <MCPPanelEmptyState />
  }

  const handleToggle = (serverName: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev)
      if (next.has(serverName)) {
        next.delete(serverName)
      } else {
        next.add(serverName)
      }
      return next
    })
  }

  return (
    <div className="overflow-y-auto h-full py-1" data-testid="mcp-panel">
      <motion.div
        initial={serverAnimation.enabled ? 'hidden' : false}
        animate="visible"
        variants={serverAnimation.container}
      >
        {servers.map((server) => (
          <motion.div key={server.serverName} variants={serverAnimation.item}>
            <MCPServerRow
              server={server}
              isExpanded={expandedServers.has(server.serverName)}
              onToggle={() => handleToggle(server.serverName)}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
