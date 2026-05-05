/**
 * Minimal ANSI escape code parser.
 *
 * Converts ANSI-coloured terminal output into an array of styled segments
 * suitable for React rendering.  Handles:
 *   - SGR reset          : ESC[0m
 *   - Bold               : ESC[1m
 *   - Dim                : ESC[2m
 *   - Standard fg colors : ESC[30-37m, ESC[90-97m
 *   - 256-color fg       : ESC[38;5;<n>m
 *   - Truecolor fg       : ESC[38;2;<r>;<g>;<b>m
 *   - Background colors  : stripped (not rendered)
 *   - Other sequences    : stripped
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnsiStyle {
  color?: string // CSS colour value, e.g. '#f38ba8' or 'rgb(255,128,0)'
  bold?: boolean
  dim?: boolean
}

export interface AnsiSegment {
  text: string
  style: AnsiStyle
}

// ---------------------------------------------------------------------------
// Standard 16-colour palette (Catppuccin Mocha — matches app palette)
// ---------------------------------------------------------------------------

const STANDARD_FG: Record<number, string> = {
  30: '#45475a', // black (bright → Surface 1)
  31: '#f38ba8', // red
  32: '#a6e3a1', // green
  33: '#f9e2af', // yellow
  34: '#89b4fa', // blue
  35: '#f5c2e7', // magenta
  36: '#89dceb', // cyan
  37: '#cdd6f4', // white (text)
  // Bright variants (90-97)
  90: '#585b70', // bright black / dark grey
  91: '#f38ba8', // bright red
  92: '#a6e3a1', // bright green
  93: '#f9e2af', // bright yellow
  94: '#89b4fa', // bright blue
  95: '#f5c2e7', // bright magenta
  96: '#89dceb', // bright cyan
  97: '#cdd6f4', // bright white
}

// ---------------------------------------------------------------------------
// 256-colour palette helper
// ---------------------------------------------------------------------------

function ansi256ToHex(n: number): string {
  if (n < 8) {
    // Standard colours
    return STANDARD_FG[n + 30] ?? '#cdd6f4'
  }
  if (n < 16) {
    // High-intensity colours
    return STANDARD_FG[n + 82] ?? '#cdd6f4' // 82 = 90 - 8
  }
  if (n < 232) {
    // 6×6×6 colour cube starting at index 16
    const i = n - 16
    const b = i % 6
    const g = Math.floor(i / 6) % 6
    const r = Math.floor(i / 36)
    const toHex = (v: number) =>
      Math.round(v === 0 ? 0 : 55 + v * 40)
        .toString(16)
        .padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
  // Greyscale ramp (232-255)
  const grey = Math.round(8 + (n - 232) * 10.2)
    .toString(16)
    .padStart(2, '0')
  return `#${grey}${grey}${grey}`
}

function parseSgrCodes(rawCodes: string): number[] {
  return rawCodes === '' ? [0] : rawCodes.split(';').map(Number)
}

function clearColor(style: AnsiStyle): AnsiStyle {
  return { ...style, color: undefined }
}

function applySimpleSgrCode(style: AnsiStyle, code: number): AnsiStyle | null {
  switch (code) {
    case 0:
      return {}
    case 1:
      return { ...style, bold: true }
    case 2:
      return { ...style, dim: true }
    case 22:
      return { ...style, bold: false, dim: false }
    case 39:
      return clearColor(style)
    default:
      if (STANDARD_FG[code] !== undefined) {
        return { ...style, color: STANDARD_FG[code] }
      }
      return null
  }
}

function getExtendedForegroundColor(
  codes: number[],
  index: number,
): { color: string; consumedCodes: number } | null {
  if (codes[index + 1] === 5 && codes[index + 2] !== undefined) {
    return {
      color: ansi256ToHex(codes[index + 2]),
      consumedCodes: 2,
    }
  }

  const red = codes[index + 2]
  const green = codes[index + 3]
  const blue = codes[index + 4]

  if (codes[index + 1] !== 2 || red === undefined || green === undefined || blue === undefined) {
    return null
  }

  return {
    color: `rgb(${red},${green},${blue})`,
    consumedCodes: 4,
  }
}

function applySgrCodes(style: AnsiStyle, codes: number[]): AnsiStyle {
  let nextStyle = { ...style }

  for (let index = 0; index < codes.length; index++) {
    const code = codes[index]

    if (code === 38) {
      const extendedColor = getExtendedForegroundColor(codes, index)
      if (extendedColor) {
        nextStyle = { ...nextStyle, color: extendedColor.color }
        index += extendedColor.consumedCodes
      }
      continue
    }

    const updatedStyle = applySimpleSgrCode(nextStyle, code)
    if (updatedStyle) {
      nextStyle = updatedStyle
    }
  }

  return nextStyle
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** ESC [ … m — matches the code part between '[' and 'm' */
// Use RegExp constructor to avoid the no-control-regex lint rule (\x1b = ESC char)
const ESC_CHAR = '\x1b'
const ANSI_RE = new RegExp(ESC_CHAR + '\\[([0-9;]*)m', 'g')

/**
 * Parse an ANSI-encoded string into styled text segments.
 *
 * The returned array always has at least one entry (possibly with empty text).
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let current: AnsiStyle = {}
  let lastIndex = 0

  ANSI_RE.lastIndex = 0 // reset stateful regex

  let match: RegExpExecArray | null
  while ((match = ANSI_RE.exec(input)) !== null) {
    // Text before this escape sequence
    if (match.index > lastIndex) {
      segments.push({
        text: input.slice(lastIndex, match.index),
        style: { ...current },
      })
    }

    // Parse the SGR codes
    current = applySgrCodes(current, parseSgrCodes(match[1]))

    lastIndex = match.index + match[0].length
  }

  // Remaining text after last escape
  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex), style: { ...current } })
  }

  return segments.length > 0 ? segments : [{ text: input, style: {} }]
}

/**
 * Returns true when the string contains at least one ANSI escape sequence.
 */
export function hasAnsi(text: string): boolean {
  // Use RegExp constructor to avoid the no-control-regex lint rule (\x1b = ESC char)
  return new RegExp(ESC_CHAR + '\\[').test(text)
}
