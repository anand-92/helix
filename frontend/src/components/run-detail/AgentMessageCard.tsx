/**
 * AgentMessageCard — Rich rendering for agent_message events.
 *
 * Renders each content block according to its type:
 *  - text        → MarkdownRenderer (GFM + shiki code highlighting)
 *  - thinking    → ThinkingBlock (collapsible reasoning section)
 *  - tool_use    → compact label (tool invocation inside message stream)
 *  - tool_result → TerminalOutput for bash-like results; JSON otherwise
 *  - (other)     → plain monospace fallback
 */

import { Bot, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import CopyButton from '@/components/CopyButton'
import MarkdownRenderer from './MarkdownRenderer'
import ThinkingBlock from './ThinkingBlock'
import TerminalOutput from './TerminalOutput'
import type { RunEvent } from '@/types/run'

// ---------------------------------------------------------------------------
// Shared helpers (mirror EventCard.tsx)
// ---------------------------------------------------------------------------

function Timestamp({ iso }: { iso: string }) {
  return (
    <time
      dateTime={iso}
      className="text-[10px] text-muted-foreground/50 font-mono tabular-nums shrink-0"
      data-testid="event-timestamp"
    >
      {formatRelativeTime(iso)}
    </time>
  )
}

function SubagentBadge({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0 text-[10px] font-medium text-indigo-400"
      data-testid="subagent-badge"
    >
      <Bot className="mr-0.5 size-2.5" aria-hidden="true" />
      {name}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Content block renderer
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  name?: string
  input?: unknown
  content?: unknown
}

function renderContentBlock(block: ContentBlock, index: number) {
  switch (block.type) {
    case 'text':
      return block.text ? (
        <div key={index} className="relative group mt-2" data-testid="agent-text-block">
          <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <CopyButton text={block.text} label="Copy agent output" />
          </div>
          <MarkdownRenderer>{block.text}</MarkdownRenderer>
        </div>
      ) : null

    case 'thinking':
      return <ThinkingBlock key={index} text={block.thinking ?? ''} className="mt-2" />

    case 'tool_use':
      return (
        <div
          key={index}
          className="mt-2 rounded border border-border/25 bg-muted/10 px-3 py-1.5 font-mono text-[10px] text-muted-foreground/60"
          data-testid="content-block-tool-use"
        >
          ↳ using tool:{' '}
          <span className="font-semibold text-foreground/70">{block.name ?? 'unknown'}</span>
        </div>
      )

    case 'tool_result': {
      // Try to render as terminal output if the content looks like shell output
      const content = block.content
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((c: ContentBlock) => c.type === 'text')
                .map((c: ContentBlock) => c.text ?? '')
                .join('\n')
            : typeof content === 'object' && content !== null
              ? JSON.stringify(content, null, 2)
              : String(content ?? '')

      return (
        <div key={index} data-testid="content-block-tool-result">
          <TerminalOutput output={text} className="mt-2" />
        </div>
      )
    }

    default:
      return (
        <pre
          key={index}
          className="mt-2 rounded border border-border/20 bg-muted/10 p-2 font-mono text-[10px] text-muted-foreground/50 whitespace-pre-wrap break-all"
          data-testid="content-block-unknown"
        >
          {JSON.stringify(block, null, 2)}
        </pre>
      )
  }
}

// ---------------------------------------------------------------------------
// AgentMessageCard
// ---------------------------------------------------------------------------

interface AgentMessageCardProps {
  event: RunEvent
}

/**
 * Rich card for agent_message events.
 *
 * Shows the role header and renders every content block with the
 * appropriate renderer (markdown, thinking, terminal, …).
 *
 * Uses `data-testid="event-card-agent-message"` for backward compat with
 * the EventTimeline test suite.
 */
export default function AgentMessageCard({ event }: AgentMessageCardProps) {
  const contentBlocks = (event.payload.content_blocks as ContentBlock[]) ?? []
  const role = (event.payload.role as string) ?? 'assistant'
  const subagentName = (() => {
    const n = event.payload.subagent_name
    return typeof n === 'string' && n.length > 0 ? n : null
  })()

  return (
    <div
      className={cn('rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2.5')}
      data-testid="event-card-agent-message"
      data-event-id={event.id}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <MessageSquare className="size-3.5 shrink-0 text-violet-400" aria-hidden="true" />
        <span className="text-xs font-medium text-violet-300/80 capitalize">{role}</span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {subagentName && <SubagentBadge name={subagentName} />}
          <Timestamp iso={event.timestamp} />
        </div>
      </div>

      {/* ── Content blocks ──────────────────────────────────────────────── */}
      {contentBlocks.length > 0 && (
        <div className="mt-1" data-testid="agent-message-content">
          {contentBlocks.map((block, i) => renderContentBlock(block, i))}
        </div>
      )}
    </div>
  )
}
