import { Play, Square } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { useRunContext } from '@/context/RunContext'
import { useRunStore } from '@/store/useRunStore'
import type { WsStatus } from '@/types/run'

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  done: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  error: 'bg-red-500/10 text-red-500 border-red-500/20',
}

/** Visual config for each WebSocket connection status */
const WS_INDICATOR: Record<WsStatus, { dotClass: string; label: string; ariaLabel: string }> = {
  connected: {
    dotClass: 'bg-emerald-500',
    label: 'WS',
    ariaLabel: 'WebSocket connected',
  },
  connecting: {
    dotClass: 'bg-amber-400',
    label: 'WS',
    ariaLabel: 'WebSocket connecting',
  },
  disconnected: {
    dotClass: 'bg-muted-foreground/30',
    label: 'WS',
    ariaLabel: 'WebSocket disconnected',
  },
  error: {
    dotClass: 'bg-red-500',
    label: 'WS',
    ariaLabel: 'WebSocket error',
  },
}

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'bg-slate-500/10 text-slate-500 border-slate-500/20'
}

function getWebSocketPingClass(status: WsStatus): string | null {
  switch (status) {
    case 'connected':
      return 'bg-emerald-400 opacity-40'
    case 'connecting':
      return 'bg-amber-400 opacity-75'
    default:
      return null
  }
}

function RunningIndicator({
  isRunning,
  shouldReduceMotion,
}: {
  isRunning: boolean
  shouldReduceMotion: boolean
}) {
  return (
    <span className="relative flex size-2 shrink-0">
      {isRunning && !shouldReduceMotion && (
        <span className="animate-ping absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={cn(
          'relative inline-flex rounded-full size-2',
          isRunning ? 'bg-emerald-500' : 'bg-muted-foreground/40',
        )}
      />
    </span>
  )
}

function CurrentActionLabel({ actionId }: { actionId: string | null }) {
  if (!actionId) return null

  return (
    <>
      <Separator orientation="vertical" className="h-4" />
      <span className="text-xs font-medium text-muted-foreground capitalize">
        {actionId.replace(/_/g, ' ')}
      </span>
    </>
  )
}

function WebSocketIndicator({
  status,
  shouldReduceMotion,
}: {
  status: WsStatus
  shouldReduceMotion: boolean
}) {
  const indicator = WS_INDICATOR[status]
  const pingClass = getWebSocketPingClass(status)

  return (
    <div
      className="flex items-center gap-1.5 ml-2"
      title={indicator.ariaLabel}
      aria-label={indicator.ariaLabel}
      data-ws-status={status}
    >
      <span className="relative flex size-1.5 shrink-0">
        {!shouldReduceMotion && pingClass && (
          <span
            className={cn(
              'animate-ping absolute inline-flex size-full rounded-full',
              pingClass,
            )}
          />
        )}
        <span className={cn('relative inline-flex rounded-full size-1.5', indicator.dotClass)} />
      </span>
      <span className="text-xs text-muted-foreground/60 hidden sm:inline select-none">
        {indicator.label}
      </span>
    </div>
  )
}

function RunControls({
  busy,
  isRunning,
  startRun,
  stopRun,
}: {
  busy: boolean
  isRunning: boolean
  startRun: () => void
  stopRun: () => void
}) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Button
        size="sm"
        variant="default"
        className="interactive-button gap-2 font-semibold"
        disabled={busy || isRunning}
        onClick={startRun}
        aria-label="Start run"
      >
        <Play className="size-3.5" data-icon="inline-start" />
        <span className="hidden sm:inline">Start</span>
      </Button>
      <Button
        size="sm"
        variant="destructive"
        className="interactive-button gap-2"
        disabled={busy || !isRunning}
        onClick={stopRun}
        aria-label="Stop run"
      >
        <Square className="size-3.5 fill-current" data-icon="inline-start" />
        <span className="hidden sm:inline">Stop</span>
      </Button>
    </div>
  )
}

export default function Header() {
  const { data, busy, startRun, stopRun } = useRunContext()
  const wsStatus = useRunStore((s) => s.wsStatus)
  const getStartRunOptions = useRunStore((s) => s.getStartRunOptions)
  const shouldReduceMotion = useReducedMotion() ?? false
  const isRunning = data.status === 'running'
  const showCurrentAction = isRunning && data.current_action != null

  function handleStart(): void {
    void startRun(getStartRunOptions())
  }

  function handleStop(): void {
    void stopRun()
  }

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border/50 bg-card/30 px-4 gap-2 backdrop-blur z-10">
      <SidebarTrigger className="-ml-1" aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="h-4 mx-1" />

      <div className="flex items-center gap-2 flex-1 min-w-0">
        <RunningIndicator isRunning={isRunning} shouldReduceMotion={shouldReduceMotion} />
        <span
          className={cn(
            'rounded-md border px-2 py-0.5 text-xs font-medium capitalize',
            getStatusColor(data.status),
          )}
        >
          {data.status}
        </span>

        {showCurrentAction ? <CurrentActionLabel actionId={data.current_action} /> : null}
        <WebSocketIndicator status={wsStatus} shouldReduceMotion={shouldReduceMotion} />
      </div>

      <RunControls
        busy={busy}
        isRunning={isRunning}
        startRun={handleStart}
        stopRun={handleStop}
      />
    </header>
  )
}
