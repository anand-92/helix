/**
 * AgentTree — Nested agent hierarchy visualization for the Run Detail view.
 *
 * Renders a parent-child tree of all agents involved in a run:
 *   - Root node: "Orchestrator" (always present)
 *   - Child nodes: one per SubagentEvent start/stop pair
 *
 * Features:
 *   - Per-node metrics: tool call count, duration, cost (root only)
 *   - Status icons: spinner (active), check (completed), dot (idle)
 *   - Expand/collapse toggle on non-leaf nodes
 *   - Collapsed state preserved during session
 *   - Real-time metric updates from incoming events
 *   - Empty state when no subagent events are present
 */

import { useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Bot, CheckCircle2, ChevronDown, ChevronRight, Loader2, Network } from 'lucide-react'
import MotionCollapse from '@/components/MotionCollapse'
import { Skeleton } from '@/components/ui/skeleton'
import { getListAnimationConfig } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { getActionTitle } from '@/lib/run-display'
import type { RunEvent, RunUsage } from '@/types/run'
import { buildAgentTree, formatDuration, formatCost } from '@/lib/agent-tree'
import type { AgentNode } from '@/lib/agent-tree'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AgentTreeProps {
  /** All events for the current/historical run. */
  events: RunEvent[]
  /** Whether the run is currently active. Drives live status indicators. */
  isActive?: boolean
  /** Run-level usage data; shown as cost on the root node. */
  usage?: RunUsage | null
  /** Whether the tree is awaiting async data. */
  loading?: boolean
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function AgentTreeEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center h-full min-h-[120px] gap-3 text-center px-6 py-8"
      data-testid="agent-tree-empty"
    >
      <Network className="size-5 text-muted-foreground/30" aria-hidden="true" />
      <p className="text-xs text-muted-foreground/60 max-w-[180px] leading-relaxed">
        No agent delegation — events will appear when sub-agents are dispatched
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: AgentNode['status'] }) {
  const shouldReduceMotion = useReducedMotion() ?? false

  if (status === 'active') {
    return (
      <Loader2
        className={`size-3.5 shrink-0 text-primary ${shouldReduceMotion ? '' : 'animate-spin'}`}
        aria-hidden="true"
        data-testid="status-icon-active"
      />
    )
  }
  if (status === 'completed') {
    return (
      <CheckCircle2
        className="size-3.5 shrink-0 text-emerald-400"
        aria-hidden="true"
        data-testid="status-icon-completed"
      />
    )
  }
  // idle
  return (
    <span
      className="inline-flex size-3.5 shrink-0 items-center justify-center"
      data-testid="status-icon-idle"
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/30" />
    </span>
  )
}

function AgentTreeSkeleton() {
  return (
    <div className="h-full overflow-y-auto py-3" data-testid="agent-tree-skeleton">
      <div className="px-4 flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-md border border-border/30 bg-card/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <Skeleton className="size-3 rounded-full" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="ml-auto h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metric badge
// ---------------------------------------------------------------------------

function MetricBadge({ value, 'data-testid': testId }: { value: string; 'data-testid'?: string }) {
  return (
    <span
      className="inline-flex items-center rounded border border-border/30 bg-muted/20 px-1 py-0 text-[10px] font-mono text-muted-foreground/60 tabular-nums"
      data-testid={testId}
    >
      {value}
    </span>
  )
}

// ---------------------------------------------------------------------------
// AgentTreeNode — recursive node renderer
// ---------------------------------------------------------------------------

interface AgentTreeNodeProps {
  node: AgentNode
  collapsed: Set<string>
  onToggle: (id: string) => void
  shouldReduceMotion: boolean
}

function AgentTreeNode({ node, collapsed, onToggle, shouldReduceMotion }: AgentTreeNodeProps) {
  const isCollapsed = collapsed.has(node.id)
  const hasChildren = node.children.length > 0
  const indentPx = node.depth * 20 + 8
  const displayName =
    node.depth === 0 ? node.agentName : (getActionTitle(node.agentName) ?? node.agentName)
  const childrenAnimation = getListAnimationConfig(node.children.length, shouldReduceMotion)

  return (
    <motion.div data-testid="agent-tree-node" data-depth={node.depth} initial={false}>
      {/* ------------------------------------------------------------------
          Node row
      ------------------------------------------------------------------ */}
      <div
        className={cn(
          'interactive-row group flex items-center gap-2 rounded-md py-1.5 pr-3 text-xs',
          node.depth === 0 ? 'text-foreground' : 'text-muted-foreground',
        )}
        style={{ paddingLeft: `${indentPx}px` }}
      >
        {/* Toggle / spacer */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="interactive-button shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={isCollapsed ? 'Expand agent' : 'Collapse agent'}
            aria-expanded={!isCollapsed}
            data-testid="tree-node-toggle"
          >
            {isCollapsed ? (
              <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
            )}
          </button>
        ) : (
          /* Leaf node: no toggle, just indent spacer */
          <span className="size-4 shrink-0" aria-hidden="true" />
        )}

        {/* Status icon */}
        <StatusIcon status={node.status} />

        {/* Agent icon (bot for subagents, network for root) */}
        {node.depth === 0 ? (
          <Network className="size-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        ) : (
          <Bot className="size-3 shrink-0 text-indigo-400/70" aria-hidden="true" />
        )}

        {/* Agent name */}
        <span
          className={cn(
            'truncate font-medium',
            node.depth === 0 ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {displayName}
        </span>

        {/* Metrics — pushed to the right */}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {/* Tool count — shown for all nodes, zero = "0" */}
          <MetricBadge
            value={`${node.toolCallCount}`}
            data-testid={`tool-count-${node.agentName}-${node.stage ?? 'null'}`}
          />

          {/* Duration */}
          <MetricBadge
            value={formatDuration(node.durationMs)}
            data-testid={`duration-${node.agentName}-${node.stage ?? 'null'}`}
          />

          {/* Cost — root only */}
          {node.depth === 0 && (
            <MetricBadge value={formatCost(node.costUsd)} data-testid="root-cost" />
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------
          Children — hidden when collapsed
      ------------------------------------------------------------------ */}
      <MotionCollapse open={hasChildren && !isCollapsed} testId="tree-node-children">
        <motion.div
          initial={childrenAnimation.enabled ? 'hidden' : false}
          animate="visible"
          variants={childrenAnimation.container}
        >
          {node.children.map((child) => (
            <motion.div key={child.id} variants={childrenAnimation.item}>
              <AgentTreeNode
                node={child}
                collapsed={collapsed}
                onToggle={onToggle}
                shouldReduceMotion={shouldReduceMotion}
              />
            </motion.div>
          ))}
        </motion.div>
      </MotionCollapse>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// AgentTree — root component
// ---------------------------------------------------------------------------

export default function AgentTree({
  events,
  isActive = false,
  usage,
  loading = false,
}: AgentTreeProps) {
  // Collapsed state: set of node IDs that are currently collapsed.
  // Nodes start expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const shouldReduceMotion = useReducedMotion() ?? false

  // Build tree from events — updates reactively when events array changes.
  const tree = useMemo(() => buildAgentTree(events, usage, isActive), [events, usage, isActive])

  // Show empty state when no subagent events are present.
  const hasSubagentEvents = events.some((e) => e.event_type === 'subagent')
  if (loading) {
    return <AgentTreeSkeleton />
  }

  if (!hasSubagentEvents) {
    return <AgentTreeEmptyState />
  }

  const handleToggle = (nodeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  return (
    <div className="overflow-y-auto h-full py-3" data-testid="agent-tree">
      <AgentTreeNode
        node={tree}
        collapsed={collapsed}
        onToggle={handleToggle}
        shouldReduceMotion={shouldReduceMotion}
      />
    </div>
  )
}
