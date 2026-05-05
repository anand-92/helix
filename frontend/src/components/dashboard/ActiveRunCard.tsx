import { Loader2 } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useRunStore } from '@/store/useRunStore'
import { cn } from '@/lib/utils'

/**
 * Prominent active-run card. Renders only when status === 'running'.
 * Shows current action, progress bar, and liveness pulse.
 */
export default function ActiveRunCard() {
  const currentRun = useRunStore((s) => s.currentRun)
  const availableActions = useRunStore((s) => s.availableActions)
  const shouldReduceMotion = useReducedMotion() ?? false
  const navigate = useNavigate()

  if (currentRun.status !== 'running') return null

  const completedCount = currentRun.actions.length
  const selectedActionCount = availableActions.filter((action) => action.enabled).length
  const totalCount = selectedActionCount || 1
  const progressPercent = Math.min((completedCount / totalCount) * 100, 100)

  const currentActionTitle = currentRun.current_action
    ? (availableActions.find((a) => a.id === currentRun.current_action)?.title ??
      currentRun.current_action)
    : 'Initializing…'

  const handleNavigate = () => {
    if (currentRun.run_id) {
      navigate(`/runs/${currentRun.run_id}`)
    }
  }

  return (
    <Card
      className={cn(
        'flex-none mx-6 mt-3 border-emerald-500/30 bg-emerald-500/5 shadow-md',
        'interactive-card cursor-pointer hover:bg-emerald-500/10 focus-within:ring-1 focus-within:ring-emerald-500/50',
      )}
      aria-label="Active run"
      data-testid="active-run-card"
      onClick={handleNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleNavigate()
        }
      }}
    >
      <CardContent className="flex items-center gap-4 py-4 px-5">
        <div className="relative flex size-3 shrink-0" aria-hidden="true">
          {!shouldReduceMotion && (
            <span className="animate-ping absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span className="relative inline-flex rounded-full size-3 bg-emerald-500" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2
                className={`size-4 text-emerald-500 shrink-0 ${shouldReduceMotion ? '' : 'animate-spin'}`}
                aria-hidden="true"
              />
              <span className="font-semibold text-sm text-emerald-400 truncate">
                {currentActionTitle}
              </span>
            </div>
            <span
              className="text-xs font-medium text-muted-foreground shrink-0 ml-3"
              aria-label={`Action ${completedCount + 1} of ${totalCount}`}
            >
              {completedCount + 1} / {totalCount}
            </span>
          </div>

          <Progress value={progressPercent} className="h-1.5" />

          <div className="flex justify-between mt-1">
            <span className="text-xs text-muted-foreground">
              {completedCount} action{completedCount !== 1 ? 's' : ''} completed
            </span>
            <span className="text-xs font-medium text-emerald-500/80">
              {Math.round(progressPercent)}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
