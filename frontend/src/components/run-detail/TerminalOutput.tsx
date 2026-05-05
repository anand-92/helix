/**
 * TerminalOutput — Monospace terminal-styled container for bash/shell output.
 *
 * Features:
 *  - Dark background with subtle border and rounded corners
 *  - Monospace font
 *  - ANSI escape code rendering (converts to coloured spans)
 *  - Graceful fallback: plain text when no ANSI codes present
 */

import { parseAnsi, hasAnsi } from '@/lib/ansi-parse'
import type { AnsiSegment } from '@/lib/ansi-parse'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// ANSI-aware text renderer
// ---------------------------------------------------------------------------

function AnsiText({ text }: { text: string }) {
  const segments: AnsiSegment[] = parseAnsi(text)

  return (
    <>
      {segments.map((seg, i) => {
        const { color, bold, dim } = seg.style
        if (!color && !bold && !dim) {
          return <span key={i}>{seg.text}</span>
        }
        return (
          <span
            key={i}
            style={{
              color: color ?? undefined,
              fontWeight: bold ? 700 : undefined,
              opacity: dim ? 0.5 : undefined,
            }}
          >
            {seg.text}
          </span>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// TerminalOutput
// ---------------------------------------------------------------------------

interface TerminalOutputProps {
  /** Raw terminal output string, may contain ANSI escape codes */
  output: string
  /** Optional additional class names for the outer container */
  className?: string
  /** Show a "$ " prompt indicator at the top left corner */
  showPrompt?: boolean
}

/**
 * Renders terminal output in a styled container with ANSI colour support.
 *
 * The container uses a near-black background, a subtle border, and a
 * monospace font — visually distinct from the Markdown prose areas.
 */
export default function TerminalOutput({ output, className, showPrompt }: TerminalOutputProps) {
  const useAnsi = hasAnsi(output)

  return (
    <div
      className={cn(
        'relative rounded-md border border-border/30',
        'bg-[#0d0d0d] text-[#cdd6f4]',
        className,
      )}
      data-testid="terminal-output"
    >
      {/* Optional prompt indicator */}
      {showPrompt && (
        <div
          className="flex items-center gap-1.5 border-b border-border/20 px-3 py-1.5"
          aria-hidden="true"
        >
          <span className="size-2.5 rounded-full bg-red-500/60" />
          <span className="size-2.5 rounded-full bg-yellow-500/60" />
          <span className="size-2.5 rounded-full bg-green-500/60" />
        </div>
      )}

      {/* Content */}
      <pre
        className={cn(
          'overflow-x-auto p-3 font-mono text-[11px] leading-relaxed',
          'whitespace-pre-wrap break-all',
        )}
        data-testid="terminal-output-content"
      >
        {useAnsi ? <AnsiText text={output} /> : output}
      </pre>
    </div>
  )
}
