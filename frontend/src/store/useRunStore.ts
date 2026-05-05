import { create } from 'zustand'
import { API_BASE } from '@/lib/constants'
import { useSettingsStore } from '@/store/useSettingsStore'
import type {
  ActionDef,
  ActionSelection,
  CurrentRun,
  RunEvent,
  RunHistorySummary,
  WsStatus,
} from '@/types/run'

// ---------------------------------------------------------------------------
// localStorage persistence for dashboard preferences
// ---------------------------------------------------------------------------

const PREFS_KEY = 'helix:dashboard-prefs'

interface DashboardPrefs {
  selectionOverrides: Record<string, Partial<ActionSelection>>
  globalPrompt: string
  actionOrder: string[]
  mainActionOrder: string[]
  finalizerActionOrder: string[]
}

function loadPrefs(): DashboardPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw)
      return {
        selectionOverrides: {},
        globalPrompt: '',
        actionOrder: [],
        mainActionOrder: [],
        finalizerActionOrder: [],
      }
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>
    return {
      selectionOverrides: parsed.selectionOverrides ?? {},
      globalPrompt: typeof parsed.globalPrompt === 'string' ? parsed.globalPrompt : '',
      actionOrder: Array.isArray(parsed.actionOrder) ? parsed.actionOrder : [],
      mainActionOrder: Array.isArray(parsed.mainActionOrder) ? parsed.mainActionOrder : [],
      finalizerActionOrder: Array.isArray(parsed.finalizerActionOrder)
        ? parsed.finalizerActionOrder
        : [],
    }
  } catch {
    return {
      selectionOverrides: {},
      globalPrompt: '',
      actionOrder: [],
      mainActionOrder: [],
      finalizerActionOrder: [],
    }
  }
}

function savePrefs(state: DashboardPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(state))
  } catch {
    // Silently ignore storage errors (e.g. private mode)
  }
}

const INITIAL_RUN: CurrentRun = {
  run_id: null,
  status: 'idle',
  current_action: null,
  current_stage: null,
  actions: [],
  stages: [],
  output: [],
  logs: [],
  events: [],
  error: null,
  usage: null,
}

export interface StartRunOptions {
  actions?: string[]
  prompt?: string
  actionPrompts?: Record<string, string>
}

interface RunStore {
  currentRun: CurrentRun
  runHistory: RunHistorySummary[]
  availableActions: ActionDef[]
  wsStatus: WsStatus
  historyLoading: boolean
  actionsLoading: boolean
  /** Events keyed by run_id for historical (non-current) runs. */
  historicalRunEvents: Record<string, RunEvent[]>
  historicalEventsLoading: Record<string, boolean>
  /** Raw backend-err.log lines (SDK debug, uvicorn messages). */
  rawLogs: string[]
  /** Orchestrator _emit() lines for the active run. */
  runLogs: string[]

  /** User selection overrides keyed by action id. */
  selectionOverrides: Record<string, Partial<ActionSelection>>
  /** Global prompt text shared across all actions. */
  globalPrompt: string
  /** User-defined action execution order (main IDs then finalizer IDs). */
  actionOrder: string[]
  /** Drag-reorder state for main (non-finalizer) actions. */
  mainActionOrder: string[]
  /** Drag-reorder state for finalizer actions. */
  finalizerActionOrder: string[]

  // Actions
  startRun: (options?: StartRunOptions) => Promise<void>
  stopRun: () => Promise<void>
  fetchStatus: () => Promise<void>
  fetchHistory: () => Promise<void>
  fetchActions: () => Promise<void>
  fetchRunEvents: (runId: string) => Promise<void>
  fetchLogs: () => Promise<void>
  processWsMessage: (message: string) => void
  setWsStatus: (status: WsStatus) => void
  setSelectionOverride: (id: string, override: Partial<ActionSelection>) => void
  setGlobalPrompt: (prompt: string) => void
  setActionOrder: (order: string[]) => void
  setMainActionOrder: (order: string[]) => void
  setFinalizerActionOrder: (order: string[]) => void
  /** Build StartRunOptions from current selections. */
  getStartRunOptions: () => StartRunOptions
  reset: () => void
}

const _initialPrefs = loadPrefs()

function persistPrefs(
  state: Pick<
    RunStore,
    | 'selectionOverrides'
    | 'globalPrompt'
    | 'actionOrder'
    | 'mainActionOrder'
    | 'finalizerActionOrder'
  >,
): void {
  savePrefs({
    selectionOverrides: state.selectionOverrides,
    globalPrompt: state.globalPrompt,
    actionOrder: state.actionOrder,
    mainActionOrder: state.mainActionOrder,
    finalizerActionOrder: state.finalizerActionOrder,
  })
}

export const useRunStore = create<RunStore>()((set, get) => ({
  currentRun: INITIAL_RUN,
  runHistory: [],
  availableActions: [],
  wsStatus: 'disconnected',
  historyLoading: false,
  actionsLoading: false,
  historicalRunEvents: {},
  historicalEventsLoading: {},
  rawLogs: [],
  runLogs: [],
  selectionOverrides: _initialPrefs.selectionOverrides,
  globalPrompt: _initialPrefs.globalPrompt,
  actionOrder: _initialPrefs.actionOrder,
  mainActionOrder: _initialPrefs.mainActionOrder,
  finalizerActionOrder: _initialPrefs.finalizerActionOrder,

  startRun: async (options?: StartRunOptions) => {
    const apiBase = useSettingsStore.getState().settings.apiEndpointUrl || API_BASE
    try {
      const body = options
        ? {
            actions: options.actions ?? null,
            prompt: options.prompt ?? null,
            action_prompts: options.actionPrompts ?? null,
          }
        : {}
      await fetch(`${apiBase}/runs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      console.error('[RunStore] Failed to start run', e)
    }
  },

  stopRun: async () => {
    const apiBase = useSettingsStore.getState().settings.apiEndpointUrl || API_BASE
    try {
      await fetch(`${apiBase}/runs/stop`, { method: 'POST' })
    } catch (e) {
      console.error('[RunStore] Failed to stop run', e)
    }
  },

  fetchStatus: async () => {
    const apiBase = useSettingsStore.getState().settings.apiEndpointUrl || API_BASE
    try {
      const res = await fetch(`${apiBase}/runs/status`)
      if (!res.ok) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (await res.json()) as Record<string, any>
      const actions =
        (raw.actions as CurrentRun['actions']) ?? (raw.stages as CurrentRun['actions']) ?? []
      set({
        currentRun: {
          run_id: (raw.run_id as string | null) ?? null,
          status: (raw.status as string) ?? 'idle',
          current_action: (raw.current_action as string | null) ?? null,
          current_stage: (raw.current_stage as number | null) ?? null,
          actions,
          stages: actions,
          output: (raw.output as string[]) ?? [],
          logs: (raw.logs as string[]) ?? [],
          events: (raw.events as RunEvent[]) ?? [],
          error: (raw.error as string | null) ?? null,
          usage: (raw.usage as CurrentRun['usage']) ?? null,
        },
      })
    } catch (e) {
      console.error('[RunStore] Failed to fetch status', e)
    }
  },

  fetchHistory: async () => {
    const apiBase = useSettingsStore.getState().settings.apiEndpointUrl || API_BASE
    set({ historyLoading: true })
    try {
      const res = await fetch(`${apiBase}/runs/history`)
      if (!res.ok) return
      const data = (await res.json()) as RunHistorySummary[]
      set({ runHistory: data })
    } catch (e) {
      console.error('[RunStore] Failed to fetch history', e)
    } finally {
      set({ historyLoading: false })
    }
  },

  fetchActions: async () => {
    const apiBase = useSettingsStore.getState().settings.apiEndpointUrl || API_BASE
    set({ actionsLoading: true })
    try {
      const res = await fetch(`${apiBase}/actions`)
      if (!res.ok) return
      const raw = (await res.json()) as Record<string, unknown>[]
      const data: ActionDef[] = raw.map((a) => ({
        ...(a as unknown as ActionDef),
        is_finalizer: (a.is_finalizer as boolean) ?? false,
      }))
      set({ availableActions: data })
    } catch (e) {
      console.error('[RunStore] Failed to fetch actions', e)
    } finally {
      set({ actionsLoading: false })
    }
  },

  fetchRunEvents: async (runId: string) => {
    const apiBase = useSettingsStore.getState().settings.apiEndpointUrl || API_BASE
    set((state) => ({
      historicalEventsLoading: {
        ...state.historicalEventsLoading,
        [runId]: true,
      },
    }))
    try {
      const res = await fetch(`${apiBase}/runs/${runId}/events`)
      if (!res.ok) return
      const data = (await res.json()) as unknown
      // Guard: only store the result if it's a valid array
      if (!Array.isArray(data)) return
      set((state) => ({
        historicalRunEvents: {
          ...state.historicalRunEvents,
          [runId]: data as RunEvent[],
        },
      }))
    } catch (e) {
      console.error('[RunStore] Failed to fetch run events', e)
    } finally {
      set((state) => ({
        historicalEventsLoading: {
          ...state.historicalEventsLoading,
          [runId]: false,
        },
      }))
    }
  },

  fetchLogs: async () => {
    const apiBase = useSettingsStore.getState().settings.apiEndpointUrl || API_BASE
    try {
      const [rawRes, runRes] = await Promise.all([
        fetch(`${apiBase}/logs/raw`),
        fetch(`${apiBase}/logs/run`),
      ])
      if (rawRes.ok) {
        const data = (await rawRes.json()) as { lines: string[] }
        set({ rawLogs: data.lines ?? [] })
      }
      if (runRes.ok) {
        const data = (await runRes.json()) as { lines: string[] }
        set({ runLogs: data.lines ?? [] })
      }
    } catch (e) {
      console.error('[RunStore] Failed to fetch logs', e)
    }
  },

  processWsMessage: (message: string) => {
    try {
      const event = JSON.parse(message) as RunEvent
      set((state) => {
        const existingIndex = state.currentRun.events.findIndex(
          (existing) => existing.id === event.id,
        )
        const nextEvents =
          existingIndex >= 0 ? state.currentRun.events : [...state.currentRun.events, event]

        const updatedRun: CurrentRun = {
          ...state.currentRun,
          events: nextEvents,
        }

        if (event.event_type === 'system') {
          const payload = event.payload as {
            action?: string
            metadata?: Record<string, unknown>
          }
          if (payload.action === 'stage_start') {
            if (event.action_id) updatedRun.current_action = event.action_id
            if (event.stage != null) updatedRun.current_stage = event.stage
          } else if (payload.action === 'run_complete') {
            updatedRun.status = 'completed'
            updatedRun.current_action = null
          } else if (payload.action === 'run_stopped') {
            updatedRun.status = 'stopped'
            updatedRun.current_action = null
          }
        }

        return { currentRun: updatedRun }
      })
    } catch (e) {
      console.error('[RunStore] Failed to process WS message', e)
    }
  },

  setWsStatus: (status: WsStatus) => set({ wsStatus: status }),

  setSelectionOverride: (id: string, override: Partial<ActionSelection>) =>
    set((state) => {
      const next = {
        ...state.selectionOverrides,
        [id]: { ...state.selectionOverrides[id], ...override },
      }
      persistPrefs({ ...state, selectionOverrides: next })
      return { selectionOverrides: next }
    }),

  setGlobalPrompt: (prompt: string) =>
    set((state) => {
      persistPrefs({ ...state, globalPrompt: prompt })
      return { globalPrompt: prompt }
    }),

  setActionOrder: (order: string[]) =>
    set((state) => {
      persistPrefs({ ...state, actionOrder: order })
      return { actionOrder: order }
    }),

  setMainActionOrder: (order: string[]) =>
    set((state) => {
      persistPrefs({ ...state, mainActionOrder: order })
      return { mainActionOrder: order }
    }),

  setFinalizerActionOrder: (order: string[]) =>
    set((state) => {
      persistPrefs({ ...state, finalizerActionOrder: order })
      return { finalizerActionOrder: order }
    }),

  getStartRunOptions: (): StartRunOptions => {
    const { availableActions, selectionOverrides, globalPrompt, actionOrder } = get()
    const selections: Record<string, ActionSelection> = {}
    for (const action of availableActions) {
      const override = selectionOverrides[action.id] ?? {}
      selections[action.id] = {
        actionId: action.id,
        selected: override.selected ?? action.enabled,
        prompt: override.prompt ?? '',
      }
    }

    // Use user-defined order when available, falling back to server order
    const orderedActions =
      actionOrder.length > 0
        ? actionOrder
            .filter((id) => availableActions.some((a) => a.id === id))
            .concat(availableActions.filter((a) => !actionOrder.includes(a.id)).map((a) => a.id))
        : availableActions.map((a) => a.id)

    const enabledSet = new Set(availableActions.filter((a) => a.enabled).map((a) => a.id))
    const selectedIds = orderedActions.filter(
      (id) => enabledSet.has(id) && selections[id]?.selected,
    )

    const actionPrompts: Record<string, string> = {}
    for (const [id, sel] of Object.entries(selections)) {
      if (sel.prompt.trim()) actionPrompts[id] = sel.prompt.trim()
    }
    return {
      actions: selectedIds.length > 0 ? selectedIds : undefined,
      prompt: globalPrompt.trim() || undefined,
      actionPrompts: Object.keys(actionPrompts).length > 0 ? actionPrompts : undefined,
    }
  },

  reset: () =>
    set({
      currentRun: INITIAL_RUN,
      runHistory: [],
      availableActions: [],
      wsStatus: 'disconnected',
      historyLoading: false,
      actionsLoading: false,
      historicalRunEvents: {},
      historicalEventsLoading: {},
      rawLogs: [],
      runLogs: [],
      selectionOverrides: {},
      globalPrompt: '',
      actionOrder: [],
      mainActionOrder: [],
      finalizerActionOrder: [],
    }),
}))
