/**
 * LiveLogs — Terminal-style panel showing two live log streams:
 *  1. Run logs   — orchestrator _emit() messages (stage lifecycle, results)
 *  2. System logs — backend stderr: uvicorn messages + SDK debug output
 *
 * Auto-scrolls to the bottom as new lines arrive.
 * Each section is independently scrollable and collapsible.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Terminal, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// LogLine
// ---------------------------------------------------------------------------

const LINE_COLOR: Record<string, string> = {
  '[error]': 'text-red-400',
  '[output]': 'text-emerald-400',
  '[info]': 'text-blue-300/80',
  error: 'text-red-400/70',
  warn: 'text-yellow-400/70',
  'WARNING:': 'text-yellow-400/70',
  'ERROR:': 'text-red-400/70',
  'DEBUG:': 'text-muted-foreground/50',
}

function lineColor(line: string): string {
  for (const [key, cls] of Object.entries(LINE_COLOR)) {
    if (
      line.startsWith(key) ||
      line.includes(` ${key} `) ||
      line.toUpperCase().includes(key.toUpperCase())
    ) {
      return cls
    }
  }
  return 'text-muted-foreground/70'
}

// ---------------------------------------------------------------------------
// LogSection
// ---------------------------------------------------------------------------

interface LogSectionProps {
  title: string
  icon: React.ReactNode
  lines: string[]
  defaultOpen?: boolean
  accentClass?: string
}

function LogSection({
  title,
  icon,
  lines,
  defaultOpen = true,
  accentClass = 'text-cyan-400',
}: LogSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)

  useEffect(() => {
    if (open && lines.length !== prevLenRef.current) {
      const el = containerRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
      }
      prevLenRef.current = lines.length
    }
  }, [lines.length, open])

  return (
    <div className="flex flex-col min-h-0">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-left w-full',
          'border-b border-border/20 bg-black/30 hover:bg-white/[0.03]',
          'text-[11px] font-mono font-semibold',
          accentClass,
        )}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        {icon}
        <span>{title}</span>
        <span className="ml-auto text-muted-foreground/40 font-normal tabular-nums">
          {lines.length} lines
        </span>
      </button>

      {/* Log lines */}
      {open && (
        <div ref={containerRef} className="overflow-y-auto max-h-72 min-h-0">
          {lines.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-muted-foreground/40 italic font-mono">
              No output yet…
            </p>
          ) : (
            <pre className="px-3 py-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-all">
              {lines.map((line, i) => (
                <span key={i} className={cn('block', lineColor(line))}>
                  {line}
                </span>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// LiveLogs
// ---------------------------------------------------------------------------

interface LiveLogsProps {
  runLogs: string[]
  rawLogs: string[]
}

export default function LiveLogs({ runLogs, rawLogs }: LiveLogsProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#080808]">
      <LogSection
        title="Run Logs"
        icon={<Terminal className="size-3 shrink-0" />}
        lines={runLogs}
        defaultOpen={true}
        accentClass="text-cyan-400"
      />
      <LogSection
        title="System / SDK Logs"
        icon={<Cpu className="size-3 shrink-0" />}
        lines={rawLogs}
        defaultOpen={true}
        accentClass="text-violet-400"
      />
    </div>
  )
}
