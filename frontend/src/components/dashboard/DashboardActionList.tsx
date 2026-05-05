import { useState, type JSX } from 'react'
import { Reorder } from 'framer-motion'
import { Check, ChevronDown, GripVertical, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ActionDef, ActionSelection } from '@/types/run'

function getActionCardClassName(isSelected: boolean, isEnabled: boolean): string {
  const selectionClass = isSelected
    ? 'border-primary/50 bg-primary/5'
    : 'border-border/40 bg-muted/10 hover:border-primary/30 hover:bg-muted/30'
  const stateClass = isEnabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'

  return cn('rounded-lg border transition-colors', selectionClass, stateClass)
}

function getActionTitleClassName(isCurrent: boolean, isSelected: boolean): string {
  if (isCurrent) {
    return 'text-primary'
  }

  if (isSelected) {
    return 'text-foreground'
  }

  return 'text-muted-foreground/70'
}

function getFallbackSelection(action: ActionDef): ActionSelection {
  return {
    actionId: action.id,
    selected: false,
    prompt: '',
  }
}

function ActionSelectionIcon({
  isCurrent,
  isSelected,
  shouldReduceMotion,
}: {
  isCurrent: boolean
  isSelected: boolean
  shouldReduceMotion: boolean
}): JSX.Element {
  if (isCurrent) {
    return (
      <Loader2 className={cn('h-4 w-4 text-primary', !shouldReduceMotion && 'animate-spin')} />
    )
  }

  if (isSelected) {
    return <Check className="h-4 w-4 text-primary" />
  }

  return <div className="h-4 w-4 rounded border-2 border-muted-foreground/40 bg-transparent" />
}

function ActionPromptToggle({
  isOpen,
  onClick,
}: {
  isOpen: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="shrink-0 p-1 rounded text-muted-foreground/50"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      title="Add prompt for this action"
    >
      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
    </button>
  )
}

function ActionCard({
  action,
  currentActionId,
  selection,
  onToggleAction,
  onPromptChange,
  isRunning,
  shouldReduceMotion,
  isDraggable,
}: {
  action: ActionDef
  currentActionId: string | null
  selection: ActionSelection
  onToggleAction: (id: string) => void
  onPromptChange: (id: string, prompt: string) => void
  isRunning: boolean
  shouldReduceMotion: boolean
  isDraggable: boolean
}): JSX.Element {
  const [promptOpen, setPromptOpen] = useState(false)
  const isCurrent = currentActionId === action.id && isRunning
  const isSelected = selection.selected
  const canEditAction = action.enabled && !isRunning
  const showPrompt = promptOpen && canEditAction

  function handleCardClick(): void {
    if (!canEditAction) {
      return
    }

    onToggleAction(action.id)
  }

  return (
    <div className={getActionCardClassName(isSelected, action.enabled)}>
      <div className="flex items-center gap-3 px-4 py-3" onClick={handleCardClick}>
        {isDraggable ? (
          <GripVertical
            className="h-4 w-4 shrink-0 text-muted-foreground/40 cursor-grab active:cursor-grabbing"
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : null}

        <div className="shrink-0">
          <ActionSelectionIcon
            isCurrent={isCurrent}
            isSelected={isSelected}
            shouldReduceMotion={shouldReduceMotion}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-semibold', getActionTitleClassName(isCurrent, isSelected))}>
              {action.title}
            </span>
            {!action.enabled ? (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1 border-border/40 text-muted-foreground"
              >
                disabled
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-0.5">{action.description}</p>
        </div>

        {canEditAction ? (
          <ActionPromptToggle isOpen={promptOpen} onClick={() => setPromptOpen((value) => !value)} />
        ) : null}
      </div>

      {showPrompt ? (
        <div className="px-4 pb-3 pt-0">
          <Textarea
            placeholder={`Additional context for ${action.title}…`}
            value={selection.prompt}
            onChange={(event) => onPromptChange(action.id, event.target.value)}
            className="text-xs min-h-[60px] bg-background/50 border-border/40 resize-none"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}

function ActionGroup({
  actions,
  currentActionId,
  selections,
  onToggleAction,
  onPromptChange,
  isRunning,
  shouldReduceMotion,
  onReorder,
  testId,
  className,
}: {
  actions: ActionDef[]
  currentActionId: string | null
  selections: Record<string, ActionSelection>
  onToggleAction: (id: string) => void
  onPromptChange: (id: string, prompt: string) => void
  isRunning: boolean
  shouldReduceMotion: boolean
  onReorder: (order: string[]) => void
  testId: string
  className: string
}): JSX.Element {
  return (
    <Reorder.Group
      axis="y"
      values={actions.map((action) => action.id)}
      onReorder={isRunning ? () => undefined : onReorder}
      className={className}
      data-testid={testId}
    >
      {actions.map((action) => (
        <Reorder.Item key={action.id} value={action.id} dragListener={!isRunning} className="list-none">
          <ActionCard
            action={action}
            currentActionId={currentActionId}
            selection={selections[action.id] ?? getFallbackSelection(action)}
            onToggleAction={onToggleAction}
            onPromptChange={onPromptChange}
            isRunning={isRunning}
            shouldReduceMotion={shouldReduceMotion}
            isDraggable={!isRunning}
          />
        </Reorder.Item>
      ))}
    </Reorder.Group>
  )
}

function EmptyActionList(): JSX.Element {
  return (
    <div className="p-4 flex flex-col gap-2">
      <Skeleton className="h-[68px] w-full rounded-lg" />
      <Skeleton className="h-[68px] w-full rounded-lg" />
      <Skeleton className="h-[68px] w-full rounded-lg" />
    </div>
  )
}

export default function DashboardActionList({
  availableActions,
  orderedMainActions,
  orderedFinalizerActions,
  currentActionId,
  selections,
  onToggleAction,
  onPromptChange,
  isRunning,
  shouldReduceMotion,
  setMainActionOrder,
  setFinalizerActionOrder,
}: {
  availableActions: ActionDef[]
  orderedMainActions: ActionDef[]
  orderedFinalizerActions: ActionDef[]
  currentActionId: string | null
  selections: Record<string, ActionSelection>
  onToggleAction: (id: string) => void
  onPromptChange: (id: string, prompt: string) => void
  isRunning: boolean
  shouldReduceMotion: boolean
  setMainActionOrder: (order: string[]) => void
  setFinalizerActionOrder: (order: string[]) => void
}): JSX.Element {
  if (availableActions.length === 0) {
    return <EmptyActionList />
  }

  return (
    <>
      <ActionGroup
        actions={orderedMainActions}
        currentActionId={currentActionId}
        selections={selections}
        onToggleAction={onToggleAction}
        onPromptChange={onPromptChange}
        isRunning={isRunning}
        shouldReduceMotion={shouldReduceMotion}
        onReorder={setMainActionOrder}
        className="p-4 flex flex-col gap-2"
        testId="main-actions"
      />

      {orderedFinalizerActions.length > 0 ? (
        <div className="px-4 pb-4 flex flex-col" data-testid="finalizer-actions">
          <h3 className="text-sm font-semibold text-muted-foreground mt-1 mb-2">Final pass</h3>
          <ActionGroup
            actions={orderedFinalizerActions}
            currentActionId={currentActionId}
            selections={selections}
            onToggleAction={onToggleAction}
            onPromptChange={onPromptChange}
            isRunning={isRunning}
            shouldReduceMotion={shouldReduceMotion}
            onReorder={setFinalizerActionOrder}
            className="flex flex-col gap-2"
            testId="finalizer-action-list"
          />
        </div>
      ) : null}
    </>
  )
}
