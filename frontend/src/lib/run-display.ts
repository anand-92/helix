import type { RunEvent } from '@/types/run'

/** Fallback human-readable titles for numeric stage indices (backward-compat). */
const STAGE_TITLES: Record<number, string> = {
  1: 'Hello',
  2: 'Post to X',
  3: 'NBA News',
  4: 'Public IP',
  5: 'Reflect',
  6: 'Goodbye',
}

/** Human-readable title for a known action ID. */
const ACTION_TITLES: Record<string, string> = {
  hello: 'Hello',
  post_to_x: 'Post to X',
  nba_news: 'NBA News',
  ip_lookup: 'Public IP',
  reflect: 'Reflect',
  goodbye: 'Goodbye',
  debug_identity: 'Identity Debug',
  improve: 'Improve',
  email_report: 'Email Report',
  scan_world: 'Scan World',
  check_pulse: 'Check Pulse',
  make_art: 'Make Art',
}

export function getStageTitle(stage: number | null | undefined): string | null {
  if (stage == null) return null
  return STAGE_TITLES[stage] ?? null
}

export function getActionTitle(actionId: string | null | undefined): string | null {
  if (!actionId) return null
  return ACTION_TITLES[actionId] ?? actionId.replace(/_/g, ' ')
}

export function getEventStageTitle(event: RunEvent): string | null {
  // Prefer action_id-based title (new model)
  if (event.action_id) {
    return getActionTitle(event.action_id)
  }

  // Fall back to metadata title then numeric stage
  const metadata = event.payload.metadata
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const title = (metadata as Record<string, unknown>).title
    if (typeof title === 'string' && title.length > 0) {
      return title
    }
  }

  return getStageTitle(event.stage)
}
