import type { Transition, Variants } from 'framer-motion'

const LIST_ITEM_DURATION_MS = 260
const MIN_STAGGER_SPREAD_MS = 220
const MAX_STAGGER_SPREAD_MS = 420
const COLLAPSE_DURATION_SECONDS = 0.24

interface ListAnimationConfig {
  enabled: boolean
  spreadMs: number
  totalDurationMs: number
  container: Variants
  item: Variants
}

interface CollapseAnimationConfig {
  initial: { height: number | 'auto'; opacity: number }
  animate: { height: number | 'auto'; opacity: number }
  exit: { height: number | 'auto'; opacity: number }
  transition: Transition
}

export function getListAnimationConfig(
  itemCount: number,
  shouldReduceMotion: boolean,
): ListAnimationConfig {
  const enabled = !shouldReduceMotion && itemCount >= 5

  if (!enabled) {
    return {
      enabled: false,
      spreadMs: 0,
      totalDurationMs: 0,
      container: {
        hidden: { opacity: 1 },
        visible: { opacity: 1, transition: { duration: 0 } },
      },
      item: {
        hidden: { opacity: 1, y: 0 },
        visible: { opacity: 1, y: 0, transition: { duration: 0 } },
      },
    }
  }

  const spreadMs = Math.max(
    MIN_STAGGER_SPREAD_MS,
    Math.min(MAX_STAGGER_SPREAD_MS, (itemCount - 1) * 55),
  )
  const staggerChildren = itemCount > 1 ? spreadMs / 1000 / (itemCount - 1) : 0
  const totalDurationMs = spreadMs + LIST_ITEM_DURATION_MS

  return {
    enabled: true,
    spreadMs,
    totalDurationMs,
    container: {
      hidden: { opacity: 1 },
      visible: {
        opacity: 1,
        transition: {
          staggerChildren,
          delayChildren: 0.02,
        },
      },
    },
    item: {
      hidden: {
        opacity: 0,
        y: 12,
      },
      visible: {
        opacity: 1,
        y: 0,
        transition: {
          duration: LIST_ITEM_DURATION_MS / 1000,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
  }
}

export function getCollapseAnimationConfig(shouldReduceMotion: boolean): CollapseAnimationConfig {
  if (shouldReduceMotion) {
    return {
      initial: { height: 'auto', opacity: 1 },
      animate: { height: 'auto', opacity: 1 },
      exit: { height: 'auto', opacity: 1 },
      transition: { duration: 0 },
    }
  }

  return {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: {
      duration: COLLAPSE_DURATION_SECONDS,
      ease: [0.22, 1, 0.36, 1],
    },
  }
}
