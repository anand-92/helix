import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Clock, Copy, Hash, Layers } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { getListAnimationConfig } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useRunStore } from '@/store/useRunStore'
import type { RunHistorySummary } from '@/types/run'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE_CLASSES: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  done: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  failed: 'bg-red-500/10 text-red-500 border-red-500/20',
  error: 'bg-red-500/10 text-red-500 border-red-500/20',
  running: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
}

function getStatusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASSES[status] ?? 'bg-slate-500/10 text-slate-500 border-slate-500/20'
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const ms = end - start
  if (!isFinite(ms) || ms < 0) return '—'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remaining = secs % 60
  return remaining > 0 ? `${mins}m ${remaining}s` : `${mins}m`
}

function formatCost(usage: RunHistorySummary['usage']): string {
  if (usage == null || usage.total_cost_usd == null) return '—'
  const usd = usage.total_cost_usd
  if (usd === 0) return '$0.00'
  if (usd < 0.0001) return '<$0.0001'
  return `$${usd.toFixed(4)}`
}

/** Truncate a run ID for display — show just the first segment. */
function truncateRunId(runId: string): string {
  // UUIDs look like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const firstSegment = runId.split('-')[0]
  return firstSegment ? firstSegment : runId.slice(0, 8)
}

// ---------------------------------------------------------------------------
// RunHistoryCard
// ---------------------------------------------------------------------------

interface RunHistoryCardProps {
  run: RunHistorySummary
}

function RunHistoryCard({ run }: RunHistoryCardProps) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(run.run_id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleNavigate = () => {
    navigate(`/runs/${run.run_id}`)
  }

  return (
    <Card
      className="interactive-card cursor-pointer border-border/50 shadow-sm hover:bg-muted/30 focus-within:ring-1 focus-within:ring-ring"
      onClick={handleNavigate}
      role="button"
      tabIndex={0}
      aria-label={`Run ${run.run_id}, status: ${run.status}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleNavigate()
        }
      }}
      data-testid="run-history-card"
    >
      <CardContent className="py-3 px-4 flex items-center gap-2 flex-wrap sm:flex-nowrap">
        {/* run_id with copy button */}
        <div className="flex items-center gap-1 shrink-0">
          <Hash className="size-3 text-muted-foreground/60 shrink-0" aria-hidden="true" />
          <span
            className="font-mono text-xs text-foreground/80"
            title={run.run_id}
            data-testid="run-id-truncated"
          >
            {truncateRunId(run.run_id)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="interactive-button size-5 shrink-0"
            onClick={handleCopy}
            aria-label="Copy run ID"
            data-testid="copy-run-id"
          >
            {copied ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Copy className="size-3 text-muted-foreground/60" />
            )}
          </Button>
        </div>

        {/* Status badge */}
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] h-5 px-1.5 font-medium capitalize shrink-0',
            getStatusBadgeClass(run.status),
          )}
        >
          {run.status}
        </Badge>

        {/* Metadata: duration, cost, stage count */}
        <div className="flex items-center gap-3 ml-auto shrink-0 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" title="Duration" data-testid="run-duration">
            <Clock className="size-3" aria-hidden="true" />
            {formatDuration(run.started_at, run.completed_at)}
          </span>

          <span className="font-mono" title="Cost" data-testid="run-cost">
            {formatCost(run.usage)}
          </span>

          <span
            className="flex items-center gap-1"
            title="Stages completed"
            data-testid="run-stage-count"
          >
            <Layers className="size-3" aria-hidden="true" />
            {run.stage_count}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// RunHistoryList (exported)
// ---------------------------------------------------------------------------

/**
 * Fetches run history from the Zustand store on mount and displays:
 * - Skeleton placeholder cards while loading
 * - "No runs yet" empty state when history is empty
 * - A scrollable list of RunHistoryCard items otherwise
 */
export default function RunHistoryList() {
  const runHistory = useRunStore((s) => s.runHistory)
  const fetchHistory = useRunStore((s) => s.fetchHistory)
  const loading = useRunStore((s) => s.historyLoading)
  const currentRun = useRunStore((s) => s.currentRun)
  const shouldReduceMotion = useReducedMotion() ?? false

  useEffect(() => {
    void fetchHistory()
  }, [fetchHistory])

  // Synthesise a RunHistorySummary for the active run so it appears at the top.
  // Exclude it from history if it's already there (shouldn't be while running, but be safe).
  const activeEntry: RunHistorySummary | null =
    currentRun.run_id && currentRun.status === 'running'
      ? {
          run_id: currentRun.run_id,
          status: currentRun.status,
          started_at:
            currentRun.events.length > 0
              ? currentRun.events[0].timestamp
              : new Date().toISOString(),
          completed_at: null,
          stage_count: currentRun.stages.length,
          usage: currentRun.usage ?? null,
        }
      : null

  const filteredHistory = activeEntry
    ? runHistory.filter((r) => r.run_id !== activeEntry.run_id)
    : runHistory

  const allRuns = activeEntry ? [activeEntry, ...filteredHistory] : filteredHistory

  const historyAnimation = getListAnimationConfig(allRuns.length, shouldReduceMotion)

  return (
    <Card
      className="flex flex-col h-full overflow-hidden shadow-md border-border/50"
      data-testid="run-history-list"
    >
      <CardHeader className="pb-3 pt-4 px-4 border-b border-border/50 bg-muted/20 flex-none">
        <CardTitle className="text-sm font-semibold">Run History</CardTitle>
      </CardHeader>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 flex flex-col gap-2">
          {loading && allRuns.length === 0 ? (
            /* Skeleton loading state */
            <>
              <Skeleton className="h-12 w-full rounded-md" data-testid="history-skeleton" />
              <Skeleton className="h-12 w-full rounded-md" />
              <Skeleton className="h-12 w-full rounded-md" />
            </>
          ) : allRuns.length === 0 ? (
            /* Empty state */
            <div
              className="flex flex-col items-center justify-center py-8 text-center"
              data-testid="history-empty-state"
            >
              <p className="text-sm text-muted-foreground">
                No runs yet —{' '}
                <span className="font-medium text-foreground">click Start to begin</span>
              </p>
            </div>
          ) : (
            /* History cards */
            <motion.div
              initial={historyAnimation.enabled ? 'hidden' : false}
              animate="visible"
              variants={historyAnimation.container}
              className="flex flex-col gap-2"
            >
              {allRuns.map((run) => (
                <motion.div key={run.run_id} variants={historyAnimation.item}>
                  <RunHistoryCard run={run} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </ScrollArea>
    </Card>
  )
}
