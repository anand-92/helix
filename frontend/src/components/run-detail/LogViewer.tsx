/**
 * LogViewer — Filterable, searchable log panel for run events.
 *
 * Displays all run events as compact log entries with:
 *  - Timestamp
 *  - Event type badge
 *  - Level indicator (blue=info, red=error, green=output)
 *  - Summary text
 *  - Copy-on-hover button
 *
 * Filter controls:
 *  - Toggle buttons for each EventType (tool_call, agent_message, subagent, mcp_tool, system, error)
 *  - Multiple types can be active (OR logic); empty = show all
 *  - Clear button dismisses all active filters
 *
 * Search:
 *  - Text input filters entries by keyword match (case-insensitive)
 *  - Clearing search restores all entries
 *
 * Panel scrolls independently from the event timeline.
 *
 * Pure utility functions (getEventLevel, getEventSummary, filterEvents, EVENT_TYPES)
 * live in @/lib/log-viewer-utils for testability and to satisfy react-refresh rules.
 */

import { useState, useMemo, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { getListAnimationConfig } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { EVENT_TYPES, getEventLevel, getEventSummary, filterEvents } from '@/lib/log-viewer-utils'
import type { LogLevel } from '@/lib/log-viewer-utils'
import type { RunEvent } from '@/types/run'
import CopyButton from '@/components/CopyButton'

// ---------------------------------------------------------------------------
// Types (internal)
// ---------------------------------------------------------------------------

type EventType = (typeof EVENT_TYPES)[number]

// ---------------------------------------------------------------------------
// Display maps
// ---------------------------------------------------------------------------

/** Short human labels for the filter badge buttons */
const TYPE_LABELS: Record<EventType, string> = {
  tool_call: 'tool',
  agent_message: 'message',
  subagent: 'activity',
  mcp_tool: 'mcp',
  system: 'system',
  error: 'error',
}

/** Level indicator dot colors */
const LEVEL_DOT_CLASS: Record<LogLevel, string> = {
  info: 'bg-blue-500',
  error: 'bg-red-500',
  output: 'bg-emerald-500',
}

/** Level-based text colors for summary text */
const LEVEL_TEXT_CLASS: Record<LogLevel, string> = {
  info: 'text-blue-400/70',
  error: 'text-red-400/70',
  output: 'text-emerald-400/70',
}

/** Type badge border/background/text colors */
const TYPE_BADGE_COLOR: Partial<Record<EventType | string, string>> = {
  tool_call: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  agent_message: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  subagent: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
  mcp_tool: 'border-teal-500/30 bg-teal-500/10 text-teal-400',
  system: 'border-border/40 bg-muted/20 text-muted-foreground/60',
  error: 'border-red-500/30 bg-red-500/10 text-red-400',
}

/** Active filter button colors per type */
const FILTER_ACTIVE_CLASS: Partial<Record<EventType | string, string>> = {
  tool_call: 'border-blue-500/50 bg-blue-500/15 text-blue-400',
  agent_message: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400',
  subagent: 'border-cyan-500/50 bg-cyan-500/15 text-cyan-400',
  mcp_tool: 'border-teal-500/50 bg-teal-500/15 text-teal-400',
  system: 'border-border/60 bg-muted/40 text-foreground',
  error: 'border-red-500/50 bg-red-500/15 text-red-400',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Level indicator dot — color-coded badge */
function LevelIndicator({ level }: { level: LogLevel }) {
  return (
    <span
      className={cn('inline-block size-1.5 rounded-full shrink-0 mt-0.5', LEVEL_DOT_CLASS[level])}
      data-testid="log-entry-level"
      data-level={level}
      aria-label={level}
    />
  )
}

/** Compact event type badge */
function TypeBadge({ type }: { type: string }) {
  const color = TYPE_BADGE_COLOR[type] ?? 'border-border/40 bg-muted/20 text-muted-foreground/60'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1 py-0 text-[9px] font-mono leading-4 shrink-0',
        color,
      )}
      data-testid="log-entry-type-badge"
    >
      {type}
    </span>
  )
}

/** Filter toggle button */
interface FilterButtonProps {
  type: EventType
  isActive: boolean
  onClick: () => void
}

function FilterButton({ type, isActive, onClick }: FilterButtonProps) {
  const activeClass = FILTER_ACTIVE_CLASS[type] ?? ''
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'interactive-button inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-mono',
        isActive
          ? activeClass
          : 'border-border/30 bg-transparent text-muted-foreground/50 hover:border-border/50 hover:text-muted-foreground/70',
      )}
      aria-pressed={isActive}
      data-testid={`log-filter-button-${type}`}
      data-filter-type={type}
    >
      {TYPE_LABELS[type]}
    </button>
  )
}

// ---------------------------------------------------------------------------
// LogViewer
// ---------------------------------------------------------------------------

interface LogViewerProps {
  /** Run events to display as log entries */
  events: RunEvent[]
  /** Whether the parent panel is awaiting async data. */
  loading?: boolean
}

function LogViewerSkeleton() {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" data-testid="log-viewer-skeleton">
      <div className="flex-none border-b border-border/20 px-3 py-2 space-y-2">
        <Skeleton className="h-7 w-full rounded-sm" />
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-5 w-14 rounded-sm" />
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3 flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full rounded-sm" />
        ))}
      </div>
    </div>
  )
}

/**
 * Filterable, searchable log viewer panel.
 * Displays run events in a compact list format with type/level indicators.
 */
export default function LogViewer({ events, loading = false }: LogViewerProps) {
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const shouldReduceMotion = useReducedMotion() ?? false

  // Toggle a type filter on/off
  const toggleFilter = useCallback((type: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  // Clear all active filters
  const clearFilters = useCallback(() => setActiveFilters(new Set()), [])

  // Clear search
  const clearSearch = useCallback(() => setSearchQuery(''), [])

  // Filtered + searched entries (sorted by timestamp ascending)
  const visibleEvents = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
    return filterEvents(sorted, activeFilters, searchQuery)
  }, [events, activeFilters, searchQuery])

  const hasActiveFilters = activeFilters.size > 0
  const hasSearchQuery = searchQuery.trim().length > 0
  const isEmpty = events.length === 0
  const noResults = !isEmpty && visibleEvents.length === 0
  const listAnimation = getListAnimationConfig(visibleEvents.length, shouldReduceMotion)

  if (loading) {
    return <LogViewerSkeleton />
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* ----------------------------------------------------------------
          Controls: search + type filters
      ---------------------------------------------------------------- */}
      <div className="flex-none border-b border-border/20 px-3 py-2 space-y-2">
        {/* Search input */}
        <div className="relative flex items-center">
          <Search
            className="absolute left-2 size-3 text-muted-foreground/40 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs…"
            className="w-full rounded-sm border border-border/30 bg-muted/10 pl-6 pr-6 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-border/60 focus:outline-none focus:ring-0 transition-colors"
            data-testid="log-search-input"
            aria-label="Search log entries"
          />
          {hasSearchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              className="interactive-button absolute right-2 rounded-sm text-muted-foreground/40 hover:text-muted-foreground/70"
              aria-label="Clear search"
              data-testid="log-search-clear"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Type filter buttons */}
        <div className="flex flex-wrap items-center gap-1">
          {EVENT_TYPES.map((type) => (
            <FilterButton
              key={type}
              type={type}
              isActive={activeFilters.has(type)}
              onClick={() => toggleFilter(type)}
            />
          ))}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="interactive-button inline-flex items-center gap-0.5 rounded-sm border border-border/30 px-1.5 py-0.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80"
              aria-label="Clear all filters"
              data-testid="log-filter-clear"
            >
              <X className="size-2" aria-hidden="true" />
              clear
            </button>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------------
          Log entries list — scrolls independently
      ---------------------------------------------------------------- */}
      <div className="flex-1 min-h-0 overflow-y-auto" data-testid="log-viewer-scroll">
        {isEmpty ? (
          /* No events at all */
          <div
            className="flex flex-col items-center justify-center h-full min-h-[160px] px-4 py-8 text-center"
            data-testid="log-viewer-empty"
          >
            <p className="text-xs text-muted-foreground/50 italic">
              Log entries will appear here during an active run.
            </p>
          </div>
        ) : noResults ? (
          /* Events exist but none match filters/search */
          <div
            className="flex flex-col items-center justify-center h-full min-h-[160px] px-4 py-8 text-center"
            data-testid="log-viewer-no-results"
          >
            <p className="text-xs text-muted-foreground/50">
              No entries match the current filters.
            </p>
            {(hasActiveFilters || hasSearchQuery) && (
              <button
                type="button"
                onClick={() => {
                  clearFilters()
                  clearSearch()
                }}
                className="mt-2 text-[11px] text-muted-foreground/60 underline underline-offset-2 hover:text-muted-foreground/80"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          /* Entries list */
          <motion.ul
            className="divide-y divide-border/10"
            data-testid="log-entry-list"
            initial={listAnimation.enabled ? 'hidden' : false}
            animate="visible"
            variants={listAnimation.container}
          >
            {visibleEvents.map((event) => {
              const level = getEventLevel(event)
              const summary = getEventSummary(event)
              const copyText = `[${event.event_type}] ${summary}`

              return (
                <motion.li
                  key={event.id}
                  variants={listAnimation.item}
                  className="interactive-row group flex items-start gap-2 px-3 py-1.5 hover:bg-white/[0.03]"
                  data-testid="log-entry"
                  data-event-type={event.event_type}
                  data-event-id={event.id}
                >
                  {/* Level indicator */}
                  <LevelIndicator level={level} />

                  {/* Type badge */}
                  <TypeBadge type={event.event_type} />

                  {/* Summary text */}
                  <span
                    className={cn(
                      'flex-1 min-w-0 text-[11px] break-all leading-4',
                      LEVEL_TEXT_CLASS[level],
                    )}
                    data-testid="log-entry-summary"
                  >
                    {summary}
                  </span>

                  {/* Timestamp */}
                  <time
                    dateTime={event.timestamp}
                    className="shrink-0 text-[10px] text-muted-foreground/30 font-mono tabular-nums"
                    data-testid="log-entry-timestamp"
                  >
                    {formatRelativeTime(event.timestamp)}
                  </time>

                  {/* Copy button — visible on hover */}
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <CopyButton text={copyText} label="Copy log entry" />
                  </span>
                </motion.li>
              )
            })}
          </motion.ul>
        )}
      </div>
    </div>
  )
}
