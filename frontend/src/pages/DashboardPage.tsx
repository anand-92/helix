import { useCallback, useEffect, useMemo, type JSX } from 'react'
import { useReducedMotion } from 'framer-motion'
import ActiveRunCard from '@/components/dashboard/ActiveRunCard'
import DashboardActionSelector, {
  DashboardErrorBanner,
  DashboardStatusBadge,
} from '@/components/dashboard/DashboardActionSelector'
import {
  buildActionMap,
  buildSelections,
  getOrderedActions,
  getSelectedActionIds,
} from '@/components/dashboard/dashboardActionUtils'
import RunHistoryList from '@/components/dashboard/RunHistoryList'
import { useRunContext } from '@/context/RunContext'
import { useRunStore } from '@/store/useRunStore'

export default function DashboardPage(): JSX.Element {
  const { data, busy, startRun, stopRun } = useRunContext()
  const availableActions = useRunStore((state) => state.availableActions)
  const selectionOverrides = useRunStore((state) => state.selectionOverrides)
  const globalPrompt = useRunStore((state) => state.globalPrompt)
  const setGlobalPrompt = useRunStore((state) => state.setGlobalPrompt)
  const setSelectionOverride = useRunStore((state) => state.setSelectionOverride)
  const setActionOrder = useRunStore((state) => state.setActionOrder)
  const mainActionOrder = useRunStore((state) => state.mainActionOrder)
  const setMainActionOrder = useRunStore((state) => state.setMainActionOrder)
  const finalizerActionOrder = useRunStore((state) => state.finalizerActionOrder)
  const setFinalizerActionOrder = useRunStore((state) => state.setFinalizerActionOrder)
  const getStartRunOptions = useRunStore((state) => state.getStartRunOptions)
  const shouldReduceMotion = useReducedMotion() ?? false

  const mainActions = useMemo(
    () => availableActions.filter((action) => !action.is_finalizer),
    [availableActions],
  )
  const finalizerActions = useMemo(
    () => availableActions.filter((action) => action.is_finalizer),
    [availableActions],
  )

  const selections = useMemo(
    () => buildSelections(availableActions, selectionOverrides),
    [availableActions, selectionOverrides],
  )
  const actionMap = useMemo(() => buildActionMap(availableActions), [availableActions])
  const orderedMainActions = useMemo(
    () => getOrderedActions(mainActions, mainActionOrder, actionMap),
    [mainActions, mainActionOrder, actionMap],
  )
  const orderedFinalizerActions = useMemo(
    () => getOrderedActions(finalizerActions, finalizerActionOrder, actionMap),
    [finalizerActions, finalizerActionOrder, actionMap],
  )
  const selectedIds = useMemo(
    () => getSelectedActionIds([...orderedMainActions, ...orderedFinalizerActions], selections),
    [orderedMainActions, orderedFinalizerActions, selections],
  )

  useEffect(() => {
    document.title = 'Dashboard | Helix'
  }, [])

  useEffect(() => {
    const order = [...orderedMainActions, ...orderedFinalizerActions].map((action) => action.id)
    setActionOrder(order)
  }, [orderedMainActions, orderedFinalizerActions, setActionOrder])

  const toggleAction = useCallback(
    (id: string) => {
      const current = selections[id]
      setSelectionOverride(id, { selected: !current?.selected })
    },
    [selections, setSelectionOverride],
  )

  const setActionPrompt = useCallback(
    (id: string, prompt: string) => {
      setSelectionOverride(id, { prompt })
    },
    [setSelectionOverride],
  )

  const handleStart = useCallback(() => {
    void startRun(getStartRunOptions())
  }, [startRun, getStartRunOptions])

  const handleStop = useCallback(() => {
    void stopRun()
  }, [stopRun])

  const isRunning = data.status === 'running'
  const completedCount = data.actions.length
  const totalSelected = selectedIds.length
  const availableActionCount = availableActions.length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 pt-4 pb-2 flex-none">
        <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
        <DashboardStatusBadge status={data.status} />
      </div>

      <DashboardErrorBanner error={data.error} />
      <ActiveRunCard />

      <main className="flex-1 overflow-hidden p-6 pt-3 gap-6 grid grid-cols-12">
        <div className="col-span-12 lg:col-span-4 flex flex-col h-full overflow-hidden">
          <RunHistoryList />
        </div>

        <DashboardActionSelector
          availableActions={availableActions}
          orderedMainActions={orderedMainActions}
          orderedFinalizerActions={orderedFinalizerActions}
          currentActionId={data.current_action}
          selections={selections}
          globalPrompt={globalPrompt}
          setGlobalPrompt={setGlobalPrompt}
          isRunning={isRunning}
          busy={busy}
          totalSelected={totalSelected}
          shouldReduceMotion={shouldReduceMotion}
          completedCount={completedCount}
          availableActionCount={availableActionCount}
          handleStart={handleStart}
          handleStop={handleStop}
          onToggleAction={toggleAction}
          onPromptChange={setActionPrompt}
          setMainActionOrder={setMainActionOrder}
          setFinalizerActionOrder={setFinalizerActionOrder}
        />
      </main>
    </div>
  )
}
