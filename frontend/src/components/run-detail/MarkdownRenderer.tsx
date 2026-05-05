/**
 * MarkdownRenderer — Renders markdown text with full GFM support and
 * optional syntax-highlighted code blocks via shiki.
 *
 * Features:
 *  - Headings (h1-h4), bold, italic, strikethrough
 *  - Ordered and unordered lists (nested)
 *  - Inline code (styled monospace)
 *  - Fenced code blocks with shiki syntax highlighting
 *    (async load; falls back to styled plain code while loading)
 *  - Links: clickable, open in new tab, secure (noopener)
 *  - Horizontal rules, blockquotes, tables (via remark-gfm)
 */

import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { highlightCode } from '@/lib/shiki-highlight'
import type { Components } from 'react-markdown'

// ---------------------------------------------------------------------------
// Syntax-highlighted code block (async shiki upgrade)
// ---------------------------------------------------------------------------

interface CodeBlockProps {
  lang: string
  code: string
}

function CodeBlock({ lang, code }: CodeBlockProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!lang || !code) return
    let cancelled = false
    highlightCode(code, lang).then((html) => {
      if (!cancelled && html) setHighlightedHtml(html)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  if (highlightedHtml) {
    return (
      <div
        // shiki sanitises user code content before injecting it into the HTML string
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        className={cn(
          '[&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/30',
          '[&_pre]:p-4 [&_pre]:overflow-x-auto',
          '[&_pre]:text-[12px] [&_pre]:leading-relaxed [&_pre]:font-mono',
          // Ensure shiki's background doesn't override our intent
          '[&_.shiki]:bg-transparent',
        )}
        data-testid="code-block-highlighted"
      />
    )
  }

  // Fallback — plain styled code block while shiki loads (or if it fails)
  return (
    <pre
      className={cn(
        'rounded-md border border-border/30 bg-muted/20',
        'p-4 overflow-x-auto',
        'font-mono text-[12px] leading-relaxed text-foreground/80',
      )}
      data-testid="code-block-plain"
    >
      <code>{code}</code>
    </pre>
  )
}

// ---------------------------------------------------------------------------
// Custom component overrides
// ---------------------------------------------------------------------------

function buildComponents(prose: boolean): Components {
  const headingBase = prose
    ? 'font-semibold leading-tight tracking-tight text-foreground/90'
    : 'font-semibold leading-tight tracking-tight text-foreground/90'

  return {
    // ── Headings ──────────────────────────────────────────────────────────
    h1: ({ children }) => <h1 className={cn(headingBase, 'mt-4 mb-2 text-lg')}>{children}</h1>,
    h2: ({ children }) => <h2 className={cn(headingBase, 'mt-4 mb-2 text-base')}>{children}</h2>,
    h3: ({ children }) => <h3 className={cn(headingBase, 'mt-3 mb-1.5 text-sm')}>{children}</h3>,
    h4: ({ children }) => <h4 className={cn(headingBase, 'mt-3 mb-1 text-sm')}>{children}</h4>,

    // ── Paragraphs ────────────────────────────────────────────────────────
    p: ({ children }) => <p className="my-1.5 leading-relaxed text-foreground">{children}</p>,

    // ── Lists ─────────────────────────────────────────────────────────────
    ul: ({ children }) => (
      <ul className="my-2 ml-4 list-disc space-y-0.5 text-foreground" data-testid="md-ul">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 ml-4 list-decimal space-y-0.5 text-foreground" data-testid="md-ol">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,

    // ── Inline code ───────────────────────────────────────────────────────
    // Note: code is called for both inline code AND fenced code blocks.
    // When it's a fenced block, `className` starts with "language-".
    // The `pre` wrapper passes through to our CodeBlock below.
    code: ({ className, children, ...rest }) => {
      const langMatch = /language-(\w+)/.exec(className ?? '')

      if (langMatch) {
        // Fenced code block — render via shiki-enhanced CodeBlock
        const code = String(children).replace(/\n$/, '')
        return <CodeBlock lang={langMatch[1]} code={code} />
      }

      // Inline code
      return (
        <code
          className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[0.85em] text-foreground/90"
          data-testid="md-inline-code"
          {...rest}
        >
          {children}
        </code>
      )
    },

    // Override <pre> so fenced blocks don't get double-wrapped
    pre: ({ children }) => <>{children}</>,

    // ── Links ─────────────────────────────────────────────────────────────
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors"
        data-testid="md-link"
      >
        {children}
      </a>
    ),

    // ── Emphasis / Strong ─────────────────────────────────────────────────
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground/95">{children}</strong>
    ),
    em: ({ children }) => <em className="italic text-foreground">{children}</em>,

    // ── Horizontal rule ───────────────────────────────────────────────────
    hr: () => <hr className="my-3 border-border/30" />,

    // ── Blockquote ────────────────────────────────────────────────────────
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-muted pl-3 text-muted-foreground/70 italic">
        {children}
      </blockquote>
    ),

    // ── Tables (GFM) ──────────────────────────────────────────────────────
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-md border border-border/30">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-muted/20 text-xs font-semibold text-muted-foreground">{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className="border-b border-border/20 last:border-0">{children}</tr>,
    th: ({ children }) => <th className="px-3 py-2 text-left">{children}</th>,
    td: ({ children }) => <td className="px-3 py-2 text-foreground">{children}</td>,
  }
}

// Memoize the component map (doesn't change between renders)
const DEFAULT_COMPONENTS = buildComponents(true)

// ---------------------------------------------------------------------------
// MarkdownRenderer
// ---------------------------------------------------------------------------

interface MarkdownRendererProps {
  /** Markdown string to render */
  children: string
  /** Optional extra CSS class for the wrapper div */
  className?: string
}

/**
 * Renders a markdown string with GFM extensions and shiki code highlighting.
 *
 * The wrapper div uses `text-sm` by default to match the event card sizing.
 */
export default function MarkdownRenderer({ children, className }: MarkdownRendererProps) {
  // Stable reference to avoid recreating the component map on every render
  // (components themselves capture hooks via useState/useEffect inside CodeBlock)
  const getComponents = useCallback(() => DEFAULT_COMPONENTS, [])

  return (
    <div className={cn('text-sm text-foreground', className)} data-testid="markdown-renderer">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={getComponents()}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
