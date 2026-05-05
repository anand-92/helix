import type { JSX } from 'react'
import { Info, Loader2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ActionDef, ActionSelection } from '@/types/run'
import DashboardActionList from './DashboardActionList'

const DASHBOARD_STATUS_COLORS: Record<string, string> = {
  running: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  done: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  error: 'bg-red-500/10 text-red-500 border-red-500/20',
}

function getDashboardStatusColor(status: string): string {
  return DASHBOARD_STATUS_COLORS[status] ?? 'bg-slate-500/10 text-slate-500 border-slate-500/20'
}

function getRunButtonLabel(totalSelected: number): string {
  return totalSelected > 0 ? `Run (${totalSelected})` : 'Run '
}

export function DashboardStatusBadge({ status }: { status: string }): JSX.Element {
  return (
    <span
      className={cn(
        'rounded-md border px-2 py-0.5 text-xs font-medium capitalize',
        getDashboardStatusColor(status),
      )}
    >
      {status}
    </span>
  )
}

export function DashboardErrorBanner({ error }: { error: string | null }): JSX.Element | null {
  if (!error) {
    return null
  }

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 p-3 px-6 text-destructive text-sm flex items-center gap-2 flex-none">
      <Info className="h-4 w-4 shrink-0" />
      <span className="font-medium">Error:</span> {error}
    </div>
  )
}

export default function DashboardActionSelector({
  availableActions,
  orderedMainActions,
  orderedFinalizerActions,
  currentActionId,
  selections,
  globalPrompt,
  setGlobalPrompt,
  isRunning,
  busy,
  totalSelected,
  shouldReduceMotion,
  completedCount,
  availableActionCount,
  handleStart,
  handleStop,
  onToggleAction,
  onPromptChange,
  setMainActionOrder,
  setFinalizerActionOrder,
}: {
  availableActions: ActionDef[]
  orderedMainActions: ActionDef[]
  orderedFinalizerActions: ActionDef[]
  currentActionId: string | null
  selections: Record<string, ActionSelection>
  globalPrompt: string
  setGlobalPrompt: (prompt: string) => void
  isRunning: boolean
  busy: boolean
  totalSelected: number
  shouldReduceMotion: boolean
  completedCount: number
  availableActionCount: number
  handleStart: () => void
  handleStop: () => void
  onToggleAction: (id: string) => void
  onPromptChange: (id: string, prompt: string) => void
  setMainActionOrder: (order: string[]) => void
  setFinalizerActionOrder: (order: string[]) => void
}): JSX.Element {
  return (
    <Card className="interactive-card col-span-12 lg:col-span-8 flex flex-col h-full overflow-hidden shadow-md border-border/50">
      <CardHeader className="pb-3 pt-5 px-5 bg-muted/20 border-b border-border/50 flex-none">
        <div className="flex items-center gap-2 text-foreground mb-1">
          <Zap className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Actions</CardTitle>
        </div>
        <CardDescription>Select actions to execute</CardDescription>

        <div className="mt-3">
          <Textarea
            placeholder="Overall context prompt (optional)…"
            value={globalPrompt}
            onChange={(event) => setGlobalPrompt(event.target.value)}
            disabled={isRunning}
            className="text-xs min-h-[52px] bg-background/50 border-border/40 resize-none"
          />
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            className="flex-1 gap-2 font-semibold"
            disabled={busy || isRunning || totalSelected === 0}
            onClick={handleStart}
          >
            {isRunning ? (
              <Loader2 className={cn('h-3.5 w-3.5', !shouldReduceMotion && 'animate-spin')} />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            {isRunning ? 'Running…' : getRunButtonLabel(totalSelected)}
          </Button>
          {isRunning ? (
            <Button size="sm" variant="destructive" disabled={busy} onClick={handleStop}>
              Stop
            </Button>
          ) : null}
        </div>

        {isRunning ? (
          <p className="text-xs text-muted-foreground mt-2">
            {completedCount} / {totalSelected || availableActionCount} completed
          </p>
        ) : null}
      </CardHeader>

      <ScrollArea className="flex-1 min-h-0">
        <DashboardActionList
          availableActions={availableActions}
          orderedMainActions={orderedMainActions}
          orderedFinalizerActions={orderedFinalizerActions}
          currentActionId={currentActionId}
          selections={selections}
          onToggleAction={onToggleAction}
          onPromptChange={onPromptChange}
          isRunning={isRunning}
          shouldReduceMotion={shouldReduceMotion}
          setMainActionOrder={setMainActionOrder}
          setFinalizerActionOrder={setFinalizerActionOrder}
        />
      </ScrollArea>
    </Card>
  )
}
