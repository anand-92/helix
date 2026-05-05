import { useCallback, useEffect, useRef } from 'react'
import { WS_BASE } from '@/lib/constants'
import { useRunStore } from '@/store/useRunStore'
import { useSettingsStore } from '@/store/useSettingsStore'

const MAX_DELAY = 30_000

/**
 * Compute exponential backoff delay based on the user-configured base interval.
 * Base is wsReconnectIntervalSecs from settings (converted to ms).
 * Capped at 30 seconds.
 */
function getBackoffDelay(attempt: number): number {
  const baseMs = (useSettingsStore.getState().settings.wsReconnectIntervalSecs ?? 1) * 1000
  return Math.min(baseMs * Math.pow(2, attempt), MAX_DELAY)
}

/**
 * Connects to the backend WebSocket for the given run.
 * Reconnects with exponential backoff on disconnect.
 * Reads/writes connection status and events through the Zustand store.
 *
 * @param runId - The active run's ID (null = no connection)
 */
export function useWebSocket(runId: string | null): void {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  // Track whether the hook is mounted so we don't reconnect after unmount
  const mountedRef = useRef(true)
  // Stable ref so onclose can call connect without a TDZ/immutability issue
  const connectRef = useRef<(id: string) => void>(() => undefined)

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const closeSocket = useCallback(() => {
    clearReconnectTimer()
    if (wsRef.current) {
      // Remove handlers before closing to prevent triggering onclose reconnect logic
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onerror = null
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
  }, [clearReconnectTimer])

  /**
   * Opens a WebSocket connection. All store access uses `getState()` to avoid
   * stale closure captures. Refs (wsRef, reconnectAttemptRef, etc.) are
   * stable by identity so the dependency array is intentionally empty.
   */
  const connect = useCallback((id: string) => {
    // Don't open a new connection if one is already open/connecting
    if (
      wsRef.current != null &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    useRunStore.getState().setWsStatus('connecting')

    // Use settings API URL to derive WS URL, falling back to WS_BASE constant
    const apiBase = useSettingsStore.getState().settings.apiEndpointUrl || WS_BASE
    const wsBase = apiBase.replace(/^http/, 'ws')
    const ws = new WebSocket(`${wsBase}/ws/runs/${id}`)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      reconnectAttemptRef.current = 0
      useRunStore.getState().setWsStatus('connected')
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      if (!mountedRef.current) return
      useRunStore.getState().processWsMessage(event.data)
    }

    ws.onerror = () => {
      if (!mountedRef.current) return
      useRunStore.getState().setWsStatus('error')
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      wsRef.current = null
      useRunStore.getState().setWsStatus('disconnected')

      // Only reconnect if the run is still active
      const runStatus = useRunStore.getState().currentRun.status
      if (runStatus !== 'running') return

      // Stop reconnecting after maxReconnectAttempts
      const maxAttempts = useSettingsStore.getState().settings.maxReconnectAttempts ?? 6
      if (reconnectAttemptRef.current >= maxAttempts) {
        useRunStore.getState().setWsStatus('error')
        return
      }

      const delay = getBackoffDelay(reconnectAttemptRef.current)
      reconnectAttemptRef.current += 1

      reconnectTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return
        // Fetch a fresh status snapshot before reconnecting
        void useRunStore
          .getState()
          .fetchStatus()
          .then(() => {
            if (!mountedRef.current) return
            const currentStatus = useRunStore.getState().currentRun.status
            if (currentStatus === 'running') {
              // Use ref to avoid self-referential closure issues
              connectRef.current(id)
            }
          })
      }, delay)
    }
  }, []) // empty deps — all store access via getState() or stable refs

  // Keep the ref up to date with the latest connect function
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  // Connect/disconnect based on runId changes
  useEffect(() => {
    mountedRef.current = true

    if (runId && useRunStore.getState().currentRun.status === 'running') {
      connect(runId)
    }

    return () => {
      mountedRef.current = false
      closeSocket()
      useRunStore.getState().setWsStatus('disconnected')
    }
  }, [runId, connect, closeSocket])

  // React to status changes: connect when run becomes active, close when it ends
  useEffect(() => {
    const unsubscribe = useRunStore.subscribe((state, prevState) => {
      const status = state.currentRun.status
      const prevStatus = prevState.currentRun.status
      const currentRunId = state.currentRun.run_id

      if (status === 'running' && prevStatus !== 'running' && currentRunId) {
        // Run just started — connect
        reconnectAttemptRef.current = 0
        connect(currentRunId)
      } else if (status !== 'running' && prevStatus === 'running') {
        // Run ended — close WebSocket
        clearReconnectTimer()
        if (wsRef.current) {
          wsRef.current.onclose = null
          wsRef.current.close()
          wsRef.current = null
        }
        useRunStore.getState().setWsStatus('disconnected')
      }
    })

    return unsubscribe
  }, [connect, clearReconnectTimer])
}
