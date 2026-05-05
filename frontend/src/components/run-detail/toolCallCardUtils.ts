import { isMemoryToolCall } from '@/lib/memory-tool-detection'
import { getSkillDisplayName, isSkillToolCall } from '@/lib/skill-detection'
import type { RunEvent } from '@/types/run'

const TERMINAL_TOOL_NAMES = new Set([
  'bash',
  'sh',
  'shell',
  'run_bash',
  'execute_bash',
  'computer',
])

export interface ToolCallDetails {
  displayName: string
  input: unknown
  output: unknown
  error: string | null
  phase: string
  durationMs: number | null | undefined
  subagentName: string | null
  isError: boolean
  isPre: boolean
  isBashTool: boolean
  isSkill: boolean
  isMemoryTool: boolean
  hasInput: boolean
  hasOutput: boolean
}

function getSubagentName(payload: RunEvent['payload']): string | null {
  const name = payload.subagent_name
  return typeof name === 'string' && name.length > 0 ? name : null
}

function getDurationMs(value: unknown): number | null | undefined {
  if (typeof value === 'number' || value === null) {
    return value
  }

  return undefined
}

export function getToolCallDetails(event: RunEvent): ToolCallDetails {
  const toolName = typeof event.payload.tool_name === 'string' ? event.payload.tool_name : 'unknown'
  const phase = typeof event.payload.phase === 'string' ? event.payload.phase : 'post'
  const error = typeof event.payload.error === 'string' ? event.payload.error : null
  const input = event.payload.input
  const output = event.payload.output
  const isPre = phase === 'pre'
  const isSkill = isSkillToolCall(toolName)
  const isMemoryTool = isMemoryToolCall(toolName)

  return {
    displayName: isSkill ? getSkillDisplayName(toolName) : toolName,
    input,
    output,
    error,
    phase,
    durationMs: getDurationMs(event.payload.duration_ms),
    subagentName: getSubagentName(event.payload),
    isError: error !== null,
    isPre,
    isBashTool: TERMINAL_TOOL_NAMES.has(toolName.toLowerCase()),
    isSkill,
    isMemoryTool,
    hasInput: input !== null && input !== undefined,
    hasOutput: !isPre && output !== null && output !== undefined,
  }
}

export function getCardTone(details: ToolCallDetails): string {
  if (details.isError) {
    return 'border-red-500/40 bg-red-500/[0.06]'
  }

  if (details.isMemoryTool) {
    return 'memory-tool-card'
  }

  if (details.isSkill) {
    return details.isPre
      ? 'border-violet-500/40 bg-violet-500/[0.06]'
      : 'border-violet-500/30 bg-violet-500/[0.04]'
  }

  return details.isPre ? 'border-border/30 bg-muted/10' : 'border-border/40 bg-muted/5'
}
