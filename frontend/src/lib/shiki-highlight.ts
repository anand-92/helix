/**
 * Shiki singleton — shared highlighter instance for the app.
 *
 * Uses the JavaScript regex engine (no WASM) so it works in all environments
 * including jsdom tests and server-side rendering.
 *
 * Supported languages: common web/backend langs used in agent pipelines.
 * Theme: github-dark (matches the dark app palette).
 */

import type { Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

/** Languages pre-loaded at startup. Unlisted languages fall back to plain text. */
const PRELOADED_LANGS = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'python',
  'bash',
  'sh',
  'shell',
  'json',
  'yaml',
  'html',
  'css',
  'rust',
  'go',
  'sql',
  'markdown',
  'text',
] as const

/**
 * Returns the shared Highlighter instance, creating it on first call.
 * Subsequent calls return the same in-flight promise.
 */
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter, createJavaScriptRegexEngine } = await import('shiki')
      return createHighlighter({
        themes: ['github-dark'],
        langs: PRELOADED_LANGS as unknown as string[],
        engine: createJavaScriptRegexEngine(),
      })
    })()

    // Reset on failure so future calls can retry
    highlighterPromise.catch(() => {
      highlighterPromise = null
    })
  }
  return highlighterPromise
}

/**
 * Returns HTML string with inline syntax highlighting, or null on failure.
 */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  try {
    const hl = await getHighlighter()
    // Normalize the language to one we support; fall back to plain text
    const supportedLangs = hl.getLoadedLanguages()
    const normalizedLang = supportedLangs.includes(lang) ? lang : 'text'
    return hl.codeToHtml(code, { lang: normalizedLang, theme: 'github-dark' })
  } catch {
    return null
  }
}
