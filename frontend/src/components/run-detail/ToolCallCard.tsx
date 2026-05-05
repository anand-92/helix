import type { JSX } from 'react'
import { useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { RunEvent } from '@/types/run'
import { ToolCallHeader, ToolInputSection, ToolOutputSection } from './ToolCallCardContent'
import { getCardTone, getToolCallDetails } from './toolCallCardUtils'

interface ToolCallCardProps {
  event: RunEvent
}

export default function ToolCallCard({ event }: ToolCallCardProps): JSX.Element {
  const shouldReduceMotion = useReducedMotion() ?? false
  const details = getToolCallDetails(event)

  return (
    <div
      className={cn('interactive-card rounded-md border px-3 py-2.5 text-xs', getCardTone(details))}
      data-testid="event-card-tool-call"
      data-event-id={event.id}
      data-phase={details.phase}
      data-is-memory={details.isMemoryTool ? 'true' : undefined}
      data-is-skill={details.isSkill ? 'true' : undefined}
    >
      <ToolCallHeader
        details={details}
        timestamp={event.timestamp}
        shouldReduceMotion={shouldReduceMotion}
      />

      {details.isError ? (
        <div
          className="mt-2 pl-5 font-mono text-[11px] text-red-400/90 break-all"
          data-testid="error-message"
        >
          {details.error}
        </div>
      ) : null}

      <ToolInputSection details={details} />
      <ToolOutputSection details={details} />
    </div>
  )
}
