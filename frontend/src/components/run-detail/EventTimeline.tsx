/**
 * EventTimeline — Chronological feed of all run events, grouped by stage.
 *
 * Behaviours:
 *  - Events are grouped by stage number and rendered in order.
 *  - Each stage group is collapsible and remains in its current open/closed
 *    state unless the user toggles it.
 *  - Empty state shown when no events are present.
 */

import { useMemo, useState, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { getListAnimationConfig } from '@/lib/motion'
import { getActionTitle, getStageTitle } from '@/lib/run-display'
import type { RunEvent } from '@/types/run'
import CopyAllErrors from './CopyAllErrors'
import EventCard from './EventCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StageGroup = {
  stage: number | null
  action_id: string | null
  title: string
  events: RunEvent[]
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EventsEmptyState({ shouldReduceMotion }: { shouldReduceMotion: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 text-center px-6 py-12"
      data-testid="events-empty-state"
    >
      <div className="relative flex size-3 shrink-0" aria-hidden="true">
        {!shouldReduceMotion && (
          <span className="animate-ping absolute inline-flex size-full rounded-full bg-primary/30 opacity-75" />
        )}
        <span className="relative inline-flex rounded-full size-3 bg-primary/40" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">
        No events yet — waiting for agent activity…
      </p>
    </div>
  )
}

function EventTimelineSkeleton() {
  return (
    <div className="p-5 flex flex-col gap-3" data-testid="event-timeline-skeleton">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border/40 bg-card/40 p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="ml-auto h-3 w-12" />
          </div>
          <Skeleton className="mt-3 h-10 w-full rounded-md" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage group header
// ---------------------------------------------------------------------------

function StageGroupHeader({
  group,
  expanded,
  onToggle,
  isCurrent,
}: {
  group: StageGroup
  expanded: boolean
  onToggle: () => void
  isCurrent: boolean
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs font-semibold',
        'border transition-colors cursor-pointer select-none',
        isCurrent
          ? 'border-primary/30 bg-primary/5 text-primary'
          : 'border-border/30 bg-card/30 text-muted-foreground hover:bg-card/50',
      )}
      data-testid={`stage-group-header-${group.stage ?? 'none'}`}
    >
      {expanded ? (
        <ChevronDown className="size-3.5 shrink-0" />
      ) : (
        <ChevronRight className="size-3.5 shrink-0" />
      )}
      <span>{group.title}</span>
      <span className="ml-auto text-[10px] font-mono font-normal text-muted-foreground/50 tabular-nums">
        {group.events.length} event{group.events.length !== 1 ? 's' : ''}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupEventsByStage(sortedEvents: RunEvent[]): StageGroup[] {
  // Group key: prefer stage number so mixed events (some with/without action_id)
  // from the same execution step stay in a single ordered group.
  const groupMap = new Map<string, RunEvent[]>()
  const order: string[] = []
  const metaMap = new Map<string, { stage: number | null; action_id: string | null }>()

  for (const event of sortedEvents) {
    const key = event.stage != null ? `__stage_${event.stage}` : (event.action_id ?? '__general')
    if (!groupMap.has(key)) {
      groupMap.set(key, [])
      order.push(key)
      metaMap.set(key, {
        stage: event.stage,
        action_id: event.action_id ?? null,
      })
    } else if (event.action_id) {
      const meta = metaMap.get(key)
      if (meta && !meta.action_id) {
        meta.action_id = event.action_id
      }
    }
    groupMap.get(key)!.push(event)
  }

  return order.map((key) => {
    const meta = metaMap.get(key)!
    let title: string
    if (meta.action_id) {
      title = getActionTitle(meta.action_id) ?? meta.action_id
      if (meta.stage != null) title = `${meta.stage}. ${title}`
    } else if (meta.stage != null) {
      title = `Stage ${meta.stage}: ${getStageTitle(meta.stage) ?? 'Unknown'}`
    } else {
      title = 'General'
    }
    return {
      stage: meta.stage,
      action_id: meta.action_id,
      title,
      events: groupMap.get(key)!,
    }
  })
}

// ---------------------------------------------------------------------------
// EventTimeline component
// ---------------------------------------------------------------------------

interface EventTimelineProps {
  /** Unordered array of events from the store */
  events: RunEvent[]
  /** Whether the parent run is currently active (used for live indicator) */
  isActive?: boolean
  /** Whether the parent view is still loading events */
  loading?: boolean
  /** The currently running stage number (legacy, prefer currentAction) */
  currentStage?: number | null
  /** The ID of the currently running action */
  currentAction?: string | null
}

export default function EventTimeline({
  events,
  currentStage,
  currentAction,
  loading = false,
}: EventTimelineProps) {
  const shouldReduceMotion = useReducedMotion() ?? false

  // Sort events by ascending timestamp, then deduplicate tool_call pre/post:
  // hide "pre" events when a matching "post" event exists for the same tool call.
  const sortedEvents = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )

    // Collect tool_call post-phase keys so we can suppress their pre-phase duplicates
    const postKeys = new Set<string>()
    for (const e of sorted) {
      if (e.event_type === 'tool_call' && e.payload.phase === 'post') {
        const key = `${e.stage}:${e.payload.tool_name}:${JSON.stringify(e.payload.input)}`
        postKeys.add(key)
      }
    }

    const filtered = sorted.filter((e) => {
      if (e.event_type === 'tool_call' && e.payload.phase === 'pre') {
        const key = `${e.stage}:${e.payload.tool_name}:${JSON.stringify(e.payload.input)}`
        return !postKeys.has(key)
      }
      return true
    })

    const completionKeys = new Set<string>()
    for (const e of filtered) {
      if (e.event_type === 'system' && e.payload.action === 'stage_complete') {
        completionKeys.add(`${e.stage ?? 'none'}:${e.action_id ?? 'none'}`)
      }
    }

    return filtered.filter((e) => {
      if (e.event_type !== 'subagent' || e.payload.action !== 'stop') return true
      const key = `${e.stage ?? 'none'}:${e.action_id ?? 'none'}`
      return !completionKeys.has(key)
    })
  }, [events])

  const stageGroups = useMemo(() => groupEventsByStage(sortedEvents), [sortedEvents])

  const [expandState, setExpandState] = useState<Record<string, boolean>>({})

  const isGroupExpanded = useCallback(
    (group: StageGroup): boolean => {
      const key = group.action_id ?? String(group.stage)
      if (key in expandState) return expandState[key]
      // Default: expand all groups until the user chooses otherwise.
      if (stageGroups.length > 0 && stageGroups[stageGroups.length - 1] === group) return true
      return false
    },
    [expandState, stageGroups],
  )

  const toggleStage = useCallback(
    (group: StageGroup) => {
      const key = group.action_id ?? String(group.stage)
      setExpandState((prev) => ({ ...prev, [key]: !isGroupExpanded(group) }))
    },
    [isGroupExpanded],
  )

  const listAnimation = getListAnimationConfig(sortedEvents.length, shouldReduceMotion)

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto" data-testid="event-timeline">
        {loading ? (
          <EventTimelineSkeleton />
        ) : sortedEvents.length === 0 ? (
          <EventsEmptyState shouldReduceMotion={shouldReduceMotion} />
        ) : (
          <div className="p-5 flex flex-col gap-3" data-testid="event-list">
            {stageGroups.map((group) => {
              const groupKey = group.action_id ?? String(group.stage)
              const expanded = isGroupExpanded(group)
              const isCurrent =
                (group.action_id && group.action_id === currentAction) ||
                group.stage === currentStage
              return (
                <div
                  key={groupKey}
                  data-testid={`stage-group-${group.action_id ?? group.stage ?? 'none'}`}
                >
                  <StageGroupHeader
                    group={group}
                    expanded={expanded}
                    onToggle={() => toggleStage(group)}
                    isCurrent={Boolean(isCurrent)}
                  />
                  {expanded && (
                    <motion.div
                      className="flex flex-col gap-3 mt-2 ml-2 pl-3 border-l border-border/20"
                      initial={listAnimation.enabled ? 'hidden' : false}
                      animate="visible"
                      variants={listAnimation.container}
                    >
                      {group.events.map((event) => (
                        <motion.div key={event.id} variants={listAnimation.item}>
                          <EventCard event={event} />
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div data-testid="timeline-end" aria-hidden="true" />
      </div>

      {!loading && <CopyAllErrors events={events} />}
    </div>
  )
}
