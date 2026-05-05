/**
 * Utility function for formatting error events for clipboard copy.
 * Shared between CopyAllErrors component and its tests.
 */

import type { RunEvent } from '@/types/run'

/**
 * Formats a list of error events into a human-readable multi-line string.
 *
 * Each line has the format:
 *   [ISO-timestamp] [Stage N] ErrorType: error message
 *
 * Events without a stage use "No stage" as the stage label.
 *
 * Example:
 *   [2026-03-17T10:30:00.000Z] [Stage 3] RuntimeError: Connection timed out
 *   [2026-03-17T10:31:00.000Z] [No stage] ValueError: bad input
 */
export function formatErrorsForClipboard(errorEvents: RunEvent[]): string {
  return errorEvents
    .map((ev) => {
      const ts = new Date(ev.timestamp).toISOString()
      const stage = ev.stage != null ? `Stage ${ev.stage}` : 'No stage'
      const errorType = (ev.payload.error_type as string) ?? 'Error'
      const message = (ev.payload.message as string) ?? 'Unknown error'
      return `[${ts}] [${stage}] ${errorType}: ${message}`
    })
    .join('\n')
}
