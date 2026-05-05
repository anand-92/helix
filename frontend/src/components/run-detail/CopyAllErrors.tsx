/**
 * CopyAllErrors — floating button that appears when 2+ error events exist.
 *
 * - Only renders when there are 2 or more error events in the provided list
 * - Copies all error messages with their ISO timestamps and stage context
 * - Visual feedback: label changes to "Copied!" for 2 seconds after copy
 * - Positioned via absolute so it overlays the EventTimeline container
 */

import { useState, useCallback } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatErrorsForClipboard } from '@/lib/copy-errors'
import type { RunEvent } from '@/types/run'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CopyAllErrorsProps {
  /** Full event list — this component filters internally for error events */
  events: RunEvent[]
}

/**
 * Floating "Copy All Errors" button.
 *
 * Only renders when there are 2 or more error events in `events`.
 * Intended to be placed inside a `position: relative` container
 * (e.g. the EventTimeline wrapper).
 */
export default function CopyAllErrors({ events }: CopyAllErrorsProps) {
  const [copied, setCopied] = useState(false)

  const errorEvents = events.filter((ev) => ev.event_type === 'error')

  const handleCopyAll = useCallback(async () => {
    const text = formatErrorsForClipboard(errorEvents)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable — fail silently
    }
  }, [errorEvents])

  // Only render when 2+ error events exist
  if (errorEvents.length < 2) return null

  return (
    <div className="absolute bottom-4 right-4 z-20" data-testid="copy-all-errors-container">
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 shadow-md backdrop-blur-sm"
        onClick={() => void handleCopyAll()}
        data-testid="copy-all-errors-btn"
        aria-label={`Copy all ${errorEvents.length} errors to clipboard`}
      >
        {copied ? (
          <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
        ) : (
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="text-xs font-medium">
          {copied ? 'Copied!' : `Copy All Errors (${errorEvents.length})`}
        </span>
      </Button>
    </div>
  )
}
