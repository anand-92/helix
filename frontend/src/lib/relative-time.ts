/**
 * Formats an ISO-8601 timestamp as a relative time string.
 *
 * @example
 *   formatRelativeTime('2024-01-01T00:00:00Z', Date.now()) // 'just now'
 *   formatRelativeTime('2024-01-01T00:00:05Z', Date.now() + 10_000) // '10s ago'
 *   formatRelativeTime('2024-01-01T00:02:00Z', Date.now() + 180_000) // '3m ago'
 */
export function formatRelativeTime(timestamp: string, now: number = Date.now()): string {
  const then = new Date(timestamp).getTime()
  const diffMs = now - then

  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
