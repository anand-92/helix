import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { getCollapseAnimationConfig } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface MotionCollapseProps {
  open: boolean
  children: ReactNode
  className?: string
  testId?: string
}

export default function MotionCollapse({
  open,
  children,
  className,
  testId = 'motion-collapse',
}: MotionCollapseProps) {
  const shouldReduceMotion = useReducedMotion() ?? false

  if (shouldReduceMotion) {
    if (!open) return null

    return (
      <div className={className} data-testid={testId} data-motion-mode="instant">
        {children}
      </div>
    )
  }

  const config = getCollapseAnimationConfig(false)

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          className={cn('overflow-hidden', className)}
          initial={config.initial}
          animate={config.animate}
          exit={config.exit}
          transition={config.transition}
          data-testid={testId}
          data-motion-mode="animated"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
