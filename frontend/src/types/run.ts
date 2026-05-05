/** WebSocket connection status */
export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

/** A completed action result */
export type ActionResult = {
  action_id: string
  title: string
  summary: string
  execution_index: number
}

/** An available action from the registry */
export type ActionDef = {
  id: string
  title: string
  description: string
  enabled: boolean
  is_finalizer: boolean
}

/** Per-action selection state used by the UI */
export type ActionSelection = {
  actionId: string
  selected: boolean
  prompt: string
}

/** A structured event envelope from the backend */
export type RunEvent = {
  id: string
  timestamp: string
  event_type: string
  run_id: string
  stage: number | null
  action_id: string | null
  payload: Record<string, unknown>
}

/** Usage/cost data captured from the SDK */
export type RunUsage = {
  input_tokens: number
  output_tokens: number
  total_cost_usd: number
}

/** Full state of the current (or most recent) run */
export type CurrentRun = {
  run_id: string | null
  status: string
  current_action: string | null
  current_stage: number | null // backward-compat
  actions: ActionResult[]
  stages: ActionResult[] // backward-compat alias
  output: string[]
  logs: string[]
  events: RunEvent[]
  error: string | null
  usage: RunUsage | null
}

/** Summary entry for run history */
export type RunHistorySummary = {
  run_id: string
  status: string
  started_at: string
  completed_at: string | null
  stage_count: number
  usage: RunUsage | null
}
