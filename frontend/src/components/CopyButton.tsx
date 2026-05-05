/**
 * CopyButton — reusable 1-click copy-to-clipboard button.
 *
 * - Copies `text` via navigator.clipboard.writeText()
 * - Icon changes from Copy → Check for 2 seconds after a successful copy
 * - Optionally renders "Copied!" text label next to the icon (showFeedback)
 * - Fails silently when the Clipboard API is unavailable
 * - Works on localhost (treated as a secure context by all modern browsers)
 */

import { useState, useCallback } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  /** The text to copy when clicked */
  text: string
  /** Accessible label for the button (screen readers) */
  label?: string
  /** Extra Tailwind classes applied to the underlying Button element */
  className?: string
  /** When true, renders a "Copied!" text label next to the icon for 2 seconds */
  showFeedback?: boolean
}

/**
 * Inline icon-button that copies text to clipboard with visual feedback.
 *
 * Usage:
 * ```tsx
 * <CopyButton text="some text to copy" label="Copy error message" />
 * <CopyButton text={runId} showFeedback />
 * ```
 */
export default function CopyButton({
  text,
  label = 'Copy to clipboard',
  className,
  showFeedback = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may be unavailable in some environments — fail silently
    }
  }, [text])

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-6 w-6 p-0 shrink-0', className)}
        onClick={() => void handleCopy()}
        aria-label={copied ? 'Copied!' : label}
        data-testid="copy-button"
      >
        {copied ? (
          <Check className="size-3 text-emerald-500" aria-hidden="true" />
        ) : (
          <Copy className="size-3 text-muted-foreground/60" aria-hidden="true" />
        )}
      </Button>
      {showFeedback && copied && (
        <span className="text-xs text-emerald-500 font-medium" data-testid="copy-feedback">
          Copied!
        </span>
      )}
    </span>
  )
}
