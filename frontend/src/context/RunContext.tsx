/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRunStore } from '@/store/useRunStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { ActionResult } from '@/types/run'
import type { StartRunOptions } from '@/store/useRunStore'

type RunStatus = {
  run_id: string | null
  status: string
  current_action: string | null
  current_stage: number | null
  output: string[]
  logs: string[]
  actions: ActionResult[]
  stages: ActionResult[]
  error: string | null
}

type RunContextValue = {
  data: RunStatus
  busy: boolean
  startRun: (options?: StartRunOptions) => Promise<void>
  stopRun: () => Promise<void>
}

const RunContext = createContext<RunContextValue | null>(null)

export function RunProvider({ children }: { children: React.ReactNode }) {
  const currentRun = useRunStore((s) => s.currentRun)
  const storeStartRun = useRunStore((s) => s.startRun)
  const storeStopRun = useRunStore((s) => s.stopRun)
  const fetchStatus = useRunStore((s) => s.fetchStatus)
  const fetchActions = useRunStore((s) => s.fetchActions)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetchStatus()
    void fetchActions()
  }, [fetchStatus, fetchActions])

  // Activate WebSocket whenever there is an active run_id
  useWebSocket(currentRun.run_id)

  const startRun = useCallback(
    async (options?: StartRunOptions) => {
      setBusy(true)
      try {
        await storeStartRun(options)
        await fetchStatus()
      } catch (e) {
        console.error('Failed to start run', e)
      } finally {
        setBusy(false)
      }
    },
    [storeStartRun, fetchStatus],
  )

  const stopRun = useCallback(async () => {
    setBusy(true)
    try {
      await storeStopRun()
      await fetchStatus()
    } catch (e) {
      console.error('Failed to stop run', e)
    } finally {
      setBusy(false)
    }
  }, [storeStopRun, fetchStatus])

  const data: RunStatus = {
    run_id: currentRun.run_id,
    status: currentRun.status,
    current_action: currentRun.current_action,
    current_stage: currentRun.current_stage,
    output: currentRun.output,
    logs: currentRun.logs,
    actions: currentRun.actions,
    stages: currentRun.actions,
    error: currentRun.error,
  }

  return (
    <RunContext.Provider value={{ data, busy, startRun, stopRun }}>{children}</RunContext.Provider>
  )
}

export function useRunContext() {
  const ctx = useContext(RunContext)
  if (!ctx) {
    throw new Error('useRunContext must be used within RunProvider')
  }
  return ctx
}
