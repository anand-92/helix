/**
 * Shared utilities for displaying public run data.
 * Used by LatestRunModule and RecentRunsModule.
 */

/**
 * Decode HTML entities in text content.
 * Useful for rendering sanitized text from backend.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes('&')) return text
  const el = document.createElement('textarea')
  el.innerHTML = text
  return el.value
}

/**
 * Format run duration from start and completion timestamps.
 * Returns a human-readable duration string like "1h 23m" or "45s".
 */
export function getRunDurationLabel(
  startedAt: string | null,
  completedAt: string | null,
): string | null {
  if (!startedAt || !completedAt) return null

  const startedMs = new Date(startedAt).getTime()
  const completedMs = new Date(completedAt).getTime()
  if (Number.isNaN(startedMs) || Number.isNaN(completedMs)) return null

  const totalSeconds = Math.max(0, Math.floor((completedMs - startedMs) / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`
}

/**
 * Map run status to badge variant for consistent styling.
 */
export function getStatusVariant(
  status: 'completed' | 'failed' | 'stopped',
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default'
    case 'failed':
      return 'destructive'
    case 'stopped':
      return 'secondary'
    default:
      return 'outline'
  }
}

/**
 * Get display label for run status.
 */
export function getStatusLabel(status: 'completed' | 'failed' | 'stopped'): string {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'stopped':
      return 'Stopped'
    default:
      return status
  }
}
