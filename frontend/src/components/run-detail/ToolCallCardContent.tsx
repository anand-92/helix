import { useState, type JSX, type ReactNode } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  XCircle,
} from 'lucide-react'
import CopyButton from '@/components/CopyButton'
import MotionCollapse from '@/components/MotionCollapse'
import { formatJson, tokenizeJson, truncateJson } from '@/lib/json-highlight'
import type { JsonTokenType } from '@/lib/json-highlight'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import type { ToolCallDetails } from './toolCallCardUtils'
import TerminalOutput from './TerminalOutput'

const TOKEN_CLASS: Record<JsonTokenType | 'other', string> = {
  key: 'text-blue-300',
  string: 'text-emerald-300',
  number: 'text-amber-300',
  keyword: 'text-violet-300',
  punctuation: 'text-muted-foreground/50',
  other: '',
}

function JsonHighlight({ json }: { json: string }): JSX.Element {
  const tokens = tokenizeJson(json)

  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={TOKEN_CLASS[token.type]}>
          {token.value}
        </span>
      ))}
    </>
  )
}

function Timestamp({ iso }: { iso: string }): JSX.Element {
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

function DurationBadge({ ms }: { ms: number }): JSX.Element {
  const label = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`

  return (
    <span
      className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-1.5 py-0 text-[10px] font-mono text-muted-foreground/70"
      data-testid="duration-badge"
    >
      {label}
    </span>
  )
}

function StatusBadge({ success }: { success: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium',
        success
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-red-500/30 bg-red-500/10 text-red-400',
      )}
      data-testid="status-badge"
    >
      {success ? 'success' : 'error'}
    </span>
  )
}

function SubagentBadge({ name }: { name: string }): JSX.Element {
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

function getToolNameTone(details: ToolCallDetails): string {
  if (details.isMemoryTool && !details.isError) {
    return 'memory-rainbow-text'
  }

  if (details.isSkill && !details.isError) {
    return 'text-violet-300/90'
  }

  return 'text-foreground/90'
}

function getTerminalText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value ?? ''))
}

interface CollapsibleSectionProps {
  label: string
  preview: string
  testIdPrefix: string
  copyText?: string
  collapseTestId?: string
  children: ReactNode
}

function CollapsibleSection({
  label,
  preview,
  testIdPrefix,
  copyText,
  collapseTestId,
  children,
}: CollapsibleSectionProps): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2 pl-5" data-testid={`${testIdPrefix}-section`}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="interactive-button flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground/80 cursor-pointer"
          data-testid={`${testIdPrefix}-toggle`}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span className="font-medium">{label}</span>
        </button>
        {copyText !== undefined ? (
          <CopyButton text={copyText} label={`Copy ${label.toLowerCase()}`} className="h-4 w-4" />
        ) : null}
      </div>

      {!open ? (
        <div
          className="mt-1 font-mono text-[10px] text-foreground/70 truncate"
          data-testid={`${testIdPrefix}-preview`}
        >
          {preview}
        </div>
      ) : null}

      <MotionCollapse open={open} className="mt-1" testId={collapseTestId}>
        {children}
      </MotionCollapse>
    </div>
  )
}

function JsonSection({
  label,
  value,
  testIdPrefix,
  copyText,
}: {
  label: string
  value: unknown
  testIdPrefix: string
  copyText?: string
}): JSX.Element {
  const formatted = formatJson(value)

  return (
    <CollapsibleSection
      label={label}
      preview={truncateJson(value, 120)}
      testIdPrefix={testIdPrefix}
      copyText={copyText}
    >
      <pre
        className="overflow-x-auto rounded-md border border-border/30 bg-muted/20 p-2 text-[10px] text-foreground whitespace-pre-wrap break-all"
        data-testid={`${testIdPrefix}-full`}
      >
        <JsonHighlight json={formatted} />
      </pre>
    </CollapsibleSection>
  )
}

function TerminalSection({
  label,
  value,
  testIdPrefix,
  copyText,
}: {
  label: string
  value: unknown
  testIdPrefix: string
  copyText?: string
}): JSX.Element {
  const text = getTerminalText(value)
  const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text

  return (
    <CollapsibleSection
      label={label}
      preview={preview}
      testIdPrefix={testIdPrefix}
      copyText={copyText}
      collapseTestId={`${testIdPrefix}-collapse`}
    >
      <div data-testid={`${testIdPrefix}-full`}>
        <TerminalOutput output={text} />
      </div>
    </CollapsibleSection>
  )
}

function ToolStatusIcon({
  details,
  shouldReduceMotion,
}: {
  details: ToolCallDetails
  shouldReduceMotion: boolean
}): JSX.Element {
  if (details.isSkill) {
    if (details.isPre) {
      return (
        <div
          className="relative size-3.5 shrink-0"
          data-testid="skill-phase-indicator"
          aria-label="skill invoking"
        >
          <span
            className={cn(
              'absolute inset-0 rounded-full bg-violet-400/40',
              !shouldReduceMotion && 'animate-ping',
            )}
            aria-hidden="true"
            data-testid="skill-pulse-ring"
          />
          <Sparkles className="relative size-3.5 text-violet-400" aria-hidden="true" />
        </div>
      )
    }

    return details.isError ? (
      <XCircle
        className="size-3.5 shrink-0 text-red-400"
        aria-label="error"
        data-testid="error-icon"
      />
    ) : (
      <Sparkles
        className="size-3.5 shrink-0 text-violet-400"
        aria-label="skill complete"
        data-testid="skill-success-icon"
      />
    )
  }

  if (details.isPre) {
    return (
      <Loader2
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground/60',
          !shouldReduceMotion && 'animate-spin',
        )}
        aria-label="calling"
        data-testid="phase-spinner"
      />
    )
  }

  return details.isError ? (
    <XCircle className="size-3.5 shrink-0 text-red-400" aria-label="error" data-testid="error-icon" />
  ) : (
    <CheckCircle2
      className="size-3.5 shrink-0 text-emerald-400"
      aria-label="success"
      data-testid="success-icon"
    />
  )
}

function ToolBadges({ details }: { details: ToolCallDetails }): JSX.Element {
  return (
    <>
      {details.isSkill ? (
        <span
          className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0 text-[10px] font-medium text-violet-400"
          data-testid="skill-badge"
        >
          skill
        </span>
      ) : null}
      {details.isMemoryTool ? (
        <span
          className="memory-rainbow-badge inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium"
          data-testid="memory-badge"
        >
          memory
        </span>
      ) : null}
      {details.subagentName ? <SubagentBadge name={details.subagentName} /> : null}
    </>
  )
}

function PhaseSummary({ details }: { details: ToolCallDetails }): JSX.Element {
  if (details.isPre) {
    return (
      <span
        className={cn(
          'text-[10px] italic',
          details.isSkill ? 'text-violet-400/70' : 'text-muted-foreground/60',
        )}
        data-testid="phase-calling-label"
      >
        {details.isSkill ? 'Invoking…' : 'Calling…'}
      </span>
    )
  }

  return <StatusBadge success={!details.isError} />
}

export function ToolCallHeader({
  details,
  timestamp,
  shouldReduceMotion,
}: {
  details: ToolCallDetails
  timestamp: string
  shouldReduceMotion: boolean
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <ToolStatusIcon details={details} shouldReduceMotion={shouldReduceMotion} />
      <span
        className={cn('font-bold font-mono truncate', getToolNameTone(details))}
        data-testid="tool-name"
      >
        {details.displayName}
      </span>

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <ToolBadges details={details} />
        <PhaseSummary details={details} />
        {details.durationMs != null && !details.isPre ? <DurationBadge ms={details.durationMs} /> : null}
        <Timestamp iso={timestamp} />
      </div>
    </div>
  )
}

export function ToolInputSection({ details }: { details: ToolCallDetails }): JSX.Element | null {
  if (!details.hasInput) {
    return null
  }

  return <JsonSection label="Input" value={details.input} testIdPrefix="input" />
}

export function ToolOutputSection({ details }: { details: ToolCallDetails }): JSX.Element | null {
  if (!details.hasOutput) {
    return null
  }

  if (details.isBashTool) {
    return (
      <TerminalSection
        label="Output"
        value={details.output}
        testIdPrefix="output"
        copyText={typeof details.output === 'string' ? details.output : formatJson(details.output)}
      />
    )
  }

  return (
    <JsonSection
      label="Output"
      value={details.output}
      testIdPrefix="output"
      copyText={formatJson(details.output)}
    />
  )
}
