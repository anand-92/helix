/** Supported theme preferences */
export type Theme = 'dark' | 'system'

/** Application-wide settings persisted in localStorage */
export interface AppSettings {
  /** Backend HTTP API base URL */
  apiEndpointUrl: string
  /** WebSocket reconnect base interval in seconds (min 1) */
  wsReconnectIntervalSecs: number
  /** Maximum WebSocket reconnect attempts before giving up */
  maxReconnectAttempts: number
  /** UI theme preference */
  theme: Theme
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiEndpointUrl: 'http://127.0.0.1:8000',
  wsReconnectIntervalSecs: 1,
  maxReconnectAttempts: 6,
  theme: 'dark',
}

export const SETTINGS_STORAGE_KEY = 'helix:settings'

/**
 * Load settings from localStorage, falling back to defaults for any
 * missing or invalid field.
 */
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Record<string, unknown>

    const apiEndpointUrl =
      typeof parsed.apiEndpointUrl === 'string' && parsed.apiEndpointUrl.trim()
        ? parsed.apiEndpointUrl.trim()
        : DEFAULT_SETTINGS.apiEndpointUrl

    const wsReconnectIntervalSecs =
      typeof parsed.wsReconnectIntervalSecs === 'number' &&
      Number.isFinite(parsed.wsReconnectIntervalSecs) &&
      parsed.wsReconnectIntervalSecs >= 1
        ? parsed.wsReconnectIntervalSecs
        : DEFAULT_SETTINGS.wsReconnectIntervalSecs

    const maxReconnectAttempts =
      typeof parsed.maxReconnectAttempts === 'number' &&
      Number.isFinite(parsed.maxReconnectAttempts) &&
      Number.isInteger(parsed.maxReconnectAttempts) &&
      parsed.maxReconnectAttempts >= 1
        ? parsed.maxReconnectAttempts
        : DEFAULT_SETTINGS.maxReconnectAttempts

    const theme: Theme =
      parsed.theme === 'system' || parsed.theme === 'dark' ? parsed.theme : DEFAULT_SETTINGS.theme

    return {
      apiEndpointUrl,
      wsReconnectIntervalSecs,
      maxReconnectAttempts,
      theme,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Persist settings to localStorage.
 * Throws if localStorage is unavailable (e.g. private mode with full storage).
 */
export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

/**
 * Returns true if the string is a valid http:// or https:// URL.
 */
export function isValidUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Apply theme class and reduced-motion override to the document root.
 * - 'dark': force dark mode, allow decorative animations
 * - 'system': use OS preference for both color scheme and reduced-motion
 */
export function applyTheme(theme: Theme): void {
  const html = document.documentElement
  if (theme === 'dark') {
    html.classList.add('dark')
    html.setAttribute('data-theme', 'oled-dark')
    // Override reduced-motion so decorative animations are allowed
    html.setAttribute('data-force-motion', 'on')
  } else {
    // 'system' — use OS preference for color scheme
    html.removeAttribute('data-theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (prefersDark) {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
    // Remove forced-motion override so prefers-reduced-motion is respected
    html.removeAttribute('data-force-motion')
  }
}
