/**
 * ThinkingBlock — Collapsible "thinking" / reasoning section.
 *
 * Behaviour:
 *  - Expanded by default, showing the full reasoning text immediately.
 *  - Click to collapse to just the "Thinking…" label.
 *  - Click again to expand.
 */

import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import MotionCollapse from '@/components/MotionCollapse'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// ThinkingBlock
// ---------------------------------------------------------------------------

interface ThinkingBlockProps {
  /** Raw thinking/reasoning text from the agent */
  text: string
  /** Optional extra class names for the root element */
  className?: string
}

export default function ThinkingBlock({ text, className }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div
      className={cn('rounded-md border border-violet-500/15 bg-violet-500/[0.04]', className)}
      data-testid="thinking-block"
    >
      {/* ── Clickable header ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          'interactive-button flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left',
          'text-xs font-medium text-violet-400/70 hover:text-violet-400/90',
          'cursor-pointer focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-violet-500/40',
        )}
        aria-expanded={expanded}
        data-testid="thinking-block-toggle"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
        )}
        <Brain className="size-3 shrink-0" aria-hidden="true" />
        <span>Thinking…</span>
      </button>

      {/* ── Expanded reasoning text ──────────────────────────────────────── */}
      <MotionCollapse open={expanded}>
        <div
          className="border-t border-violet-500/10 px-3 pb-3 pt-2"
          data-testid="thinking-block-content"
        >
          <p
            className={cn(
              'whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed',
              'text-muted-foreground/50 italic',
            )}
          >
            {text}
          </p>
        </div>
      </MotionCollapse>
    </div>
  )
}
