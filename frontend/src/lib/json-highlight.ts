/**
 * JSON syntax highlighting utilities (pure TypeScript, no JSX).
 *
 * See ToolCallCard.tsx for the JsonHighlight React component that consumes these.
 *
 * Provides:
 *   - formatJson(value)   — pretty-prints any JSON-serializable value
 *   - tokenizeJson(json)  — splits a JSON string into typed tokens
 *   - truncateJson(value) — compact single-line preview, truncated to N chars
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type JsonTokenType = 'key' | 'string' | 'keyword' | 'number' | 'punctuation' | 'other'

interface JsonToken {
  type: JsonTokenType
  value: string
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Splits a formatted JSON string into typed tokens for syntax highlighting.
 *
 * Handles: string keys, string values, booleans/null, numbers, punctuation ({[],:}).
 * Whitespace and newlines come back as `other` tokens.
 */
export function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = []
  // Single regex with capture groups: (string) | (keyword) | (number) | (punctuation)
  const TOKEN_RE =
    /("(?:[^"\\]|\\.)*")|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = TOKEN_RE.exec(json)) !== null) {
    // Capture any non-token content (whitespace, newlines, etc.)
    if (match.index > lastIndex) {
      tokens.push({ type: 'other', value: json.slice(lastIndex, match.index) })
    }

    if (match[1] !== undefined) {
      // Determine whether this string is a key or a value.
      // A key is a quoted string immediately followed by ':' (ignoring whitespace).
      const rest = json.slice(match.index + match[0].length)
      const isKey = /^\s*:/.test(rest)
      tokens.push({ type: isKey ? 'key' : 'string', value: match[0] })
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'keyword', value: match[0] })
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'number', value: match[0] })
    } else {
      tokens.push({ type: 'punctuation', value: match[0] })
    }

    lastIndex = match.index + match[0].length
  }

  // Capture any trailing non-token content
  if (lastIndex < json.length) {
    tokens.push({ type: 'other', value: json.slice(lastIndex) })
  }

  return tokens
}

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

/**
 * Pretty-prints any JSON-serializable value with 2-space indentation.
 *
 * If the value is a string, attempts to parse it as JSON first (so that
 * already-serialized JSON strings are formatted nicely).
 */
export function formatJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') {
    // Try to parse as JSON — if it succeeds, format the parsed object
    try {
      const parsed = JSON.parse(value)
      return JSON.stringify(parsed, null, 2)
    } catch {
      // Plain string, return as-is
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Returns a compact single-line preview of a value, truncated to `maxLen`.
 */
export function truncateJson(value: unknown, maxLen = 120): string {
  if (value === null || value === undefined) return 'null'
  const str = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}
