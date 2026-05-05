import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { RunUsage } from '@/types/run'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunDetailHeaderProps {
  runId: string
  status: string
  startedAt: string | null
  completedAt: string | null
  usage: RunUsage | null
  isActive: boolean
}

// ---------------------------------------------------------------------------
// Status badge color map (mirrors Header.tsx pattern)
// Direct Tailwind color names are required for status badges per design system.
// ---------------------------------------------------------------------------

const STATUS_BADGE_CLASS: Record<string, string> = {
  running: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  done: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  failed: 'bg-red-500/10 text-red-500 border-red-500/20',
  error: 'bg-red-500/10 text-red-500 border-red-500/20',
  stopped: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RunDetailHeader({
  runId,
  status,
  startedAt,
  completedAt,
  usage,
  isActive,
}: RunDetailHeaderProps) {
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Live timer for active runs — updates every second
  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isActive])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(runId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may be unavailable in some contexts — fail silently
    }
  }, [runId])

  // Compute elapsed duration
  let elapsedMs: number | null = null
  if (startedAt) {
    const start = new Date(startedAt).getTime()
    const end = completedAt ? new Date(completedAt).getTime() : now
    elapsedMs = Math.max(0, end - start)
  }

  const statusBadgeClass =
    STATUS_BADGE_CLASS[status] ?? 'bg-slate-500/10 text-slate-500 border-slate-500/20'

  const totalTokens = usage ? usage.input_tokens + usage.output_tokens : 0

  return (
    <div className="border-b border-border/50 bg-card/30 px-6 py-4" data-testid="run-detail-header">
      {/* Top row: run ID + copy button + status badge */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link to="/" className="text-xs font-medium text-primary hover:underline shrink-0">
            Dashboard
          </Link>
          <span className="text-muted-foreground/40 shrink-0">/</span>
          <span
            className="font-mono text-sm text-foreground/80 truncate"
            data-testid="run-id-display"
          >
            {runId}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0"
            onClick={() => void handleCopy()}
            aria-label="Copy run ID"
            data-testid="copy-run-id-btn"
          >
            {copied ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Copy className="size-3 text-muted-foreground" />
            )}
          </Button>
          {copied && (
            <span className="text-xs text-emerald-500 font-medium" data-testid="copied-feedback">
              Copied!
            </span>
          )}
        </div>

        <span
          className={cn(
            'rounded-md border px-2 py-0.5 text-xs font-medium capitalize shrink-0',
            statusBadgeClass,
          )}
          data-testid="status-badge"
        >
          {status}
        </span>
      </div>

      {/* Metadata row: start time · elapsed · cost */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {startedAt && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground/60">Started</span>
            <span className="font-medium text-foreground/70" data-testid="start-time">
              {formatDate(startedAt)}
            </span>
          </div>
        )}

        {elapsedMs !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground/60">Duration</span>
            <span
              className="font-medium text-foreground/70 font-mono"
              data-testid="elapsed-duration"
            >
              {formatDuration(elapsedMs)}
            </span>
          </div>
        )}

        {usage && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">Tokens</span>
              <span className="font-medium text-foreground/70 font-mono" data-testid="token-count">
                {totalTokens.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">Cost</span>
              <span className="font-medium text-foreground/70 font-mono" data-testid="cost-display">
                ${usage.total_cost_usd.toFixed(4)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
