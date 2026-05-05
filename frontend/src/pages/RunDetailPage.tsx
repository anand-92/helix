import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Activity, GitBranch, Network, ScrollText, TerminalSquare } from 'lucide-react'
import AgentTree from '@/components/run-detail/AgentTree'
import EventTimeline from '@/components/run-detail/EventTimeline'
import LiveLogs from '@/components/run-detail/LiveLogs'
import LogViewer from '@/components/run-detail/LogViewer'
import MCPPanel from '@/components/run-detail/MCPPanel'
import RunDetailHeader from '@/components/run-detail/RunDetailHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRunStore } from '@/store/useRunStore'
import type { CurrentRun, RunEvent, RunHistorySummary } from '@/types/run'

interface RunDetailState {
  isCurrentRun: boolean
  hasHistoricalEvents: boolean
  status: string
  usage: CurrentRun['usage']
  events: RunEvent[]
  isActive: boolean
  startedAt: string | null
  completedAt: string | null
  isPageLoading: boolean
}

function isCurrentRunId(id: string | undefined, currentRunId: string | null): boolean {
  return Boolean(id && id === currentRunId)
}

function hasHistoricalEventsForRun(
  id: string | undefined,
  historicalRunEvents: Record<string, RunEvent[]>,
): boolean {
  return Boolean(id && Object.prototype.hasOwnProperty.call(historicalRunEvents, id))
}

function getHistoryEntry(
  id: string | undefined,
  runHistory: RunHistorySummary[],
): RunHistorySummary | undefined {
  return runHistory.find((entry) => entry.run_id === id)
}

function getRunStatus(
  isCurrentRun: boolean,
  currentRun: CurrentRun,
  historyEntry: RunHistorySummary | undefined,
): string {
  return isCurrentRun ? currentRun.status : (historyEntry?.status ?? 'unknown')
}

function getRunUsage(
  isCurrentRun: boolean,
  currentRun: CurrentRun,
  historyEntry: RunHistorySummary | undefined,
): CurrentRun['usage'] {
  return isCurrentRun ? currentRun.usage : (historyEntry?.usage ?? null)
}

function getRunEvents(
  id: string | undefined,
  isCurrentRun: boolean,
  currentRun: CurrentRun,
  historicalRunEvents: Record<string, RunEvent[]>,
): RunEvent[] {
  if (isCurrentRun) {
    return currentRun.events
  }

  if (!id) {
    return []
  }

  return historicalRunEvents[id] ?? []
}

function getStartedAt(
  isCurrentRun: boolean,
  currentRun: CurrentRun,
  historyEntry: RunHistorySummary | undefined,
): string | null {
  return isCurrentRun ? (currentRun.events[0]?.timestamp ?? null) : (historyEntry?.started_at ?? null)
}

function getCompletedAt(
  isCurrentRun: boolean,
  historyEntry: RunHistorySummary | undefined,
): string | null {
  return isCurrentRun ? null : (historyEntry?.completed_at ?? null)
}

function getPageLoadingState(
  id: string | undefined,
  isCurrentRun: boolean,
  historyLoading: boolean,
  historicalEventsLoading: Record<string, boolean>,
): boolean {
  if (!id || isCurrentRun) {
    return false
  }

  return Boolean(historyLoading || historicalEventsLoading[id])
}

function getRunDetailState({
  id,
  currentRun,
  runHistory,
  historicalRunEvents,
  historyLoading,
  historicalEventsLoading,
}: {
  id: string | undefined
  currentRun: CurrentRun
  runHistory: RunHistorySummary[]
  historicalRunEvents: Record<string, RunEvent[]>
  historyLoading: boolean
  historicalEventsLoading: Record<string, boolean>
}): RunDetailState {
  const isCurrentRun = isCurrentRunId(id, currentRun.run_id)
  const hasHistoricalEvents = hasHistoricalEventsForRun(id, historicalRunEvents)
  const historyEntry = getHistoryEntry(id, runHistory)
  const status = getRunStatus(isCurrentRun, currentRun, historyEntry)
  const usage = getRunUsage(isCurrentRun, currentRun, historyEntry)
  const events = getRunEvents(id, isCurrentRun, currentRun, historicalRunEvents)
  const startedAt = getStartedAt(isCurrentRun, currentRun, historyEntry)
  const completedAt = getCompletedAt(isCurrentRun, historyEntry)
  const isPageLoading = getPageLoadingState(
    id,
    isCurrentRun,
    historyLoading,
    historicalEventsLoading,
  )

  return {
    isCurrentRun,
    hasHistoricalEvents,
    status,
    usage,
    events,
    isActive: status === 'running',
    startedAt,
    completedAt,
    isPageLoading,
  }
}

function shouldFetchHistoricalEvents(
  id: string | undefined,
  isCurrentRun: boolean,
  hasHistoricalEvents: boolean,
): id is string {
  return Boolean(id && !isCurrentRun && !hasHistoricalEvents)
}

function getRunDetailDocumentTitle(
  id: string | undefined,
  currentRunId: string | null,
  currentRunStatus: string,
): string {
  const baseTitle = `Run ${id ?? ''}`

  if (!id || currentRunId !== id) {
    return `${baseTitle} | Helix`
  }

  switch (currentRunStatus) {
    case 'running':
      return `${baseTitle} - Running | Helix`
    case 'completed':
      return `${baseTitle} - Completed | Helix`
    case 'error':
    case 'failed':
      return `${baseTitle} - Failed | Helix`
    default:
      return `${baseTitle} | Helix`
  }
}

function RunDetailHeaderSkeleton() {
  return (
    <div
      className="border-b border-border/50 bg-card/30 px-6 py-4"
      data-testid="run-detail-header-skeleton"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-6 w-6" />
        </div>
        <Skeleton className="h-5 w-20 rounded-md" />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}

function EventCount({ count }: { count: number }) {
  if (count === 0) {
    return null
  }

  return (
    <span className="text-xs text-muted-foreground font-mono">
      {count} event{count !== 1 ? 's' : ''}
    </span>
  )
}

function TabCount({ count }: { count: number }) {
  if (count === 0) {
    return null
  }

  return (
    <span className="ml-0.5 text-[10px] text-muted-foreground/50 font-mono tabular-nums">
      {count}
    </span>
  )
}

function EventTimelinePanel({
  events,
  isActive,
  isPageLoading,
  isCurrentRun,
  currentStage,
  currentAction,
}: {
  events: RunEvent[]
  isActive: boolean
  isPageLoading: boolean
  isCurrentRun: boolean
  currentStage: number | null
  currentAction: string | null
}) {
  return (
    <div
      className="col-span-12 lg:col-span-8 flex flex-col overflow-hidden border-r border-border/50"
      data-testid="event-timeline-section"
    >
      <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between flex-none">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Event Timeline</span>
        </div>
        <EventCount count={events.length} />
      </div>

      <EventTimeline
        events={events}
        isActive={isActive}
        loading={isPageLoading}
        currentStage={isCurrentRun ? currentStage : null}
        currentAction={isCurrentRun ? currentAction : null}
      />
    </div>
  )
}

function RunDetailTabsPanel({
  events,
  isActive,
  usage,
  isPageLoading,
  runLogs,
  rawLogs,
}: {
  events: RunEvent[]
  isActive: boolean
  usage: CurrentRun['usage']
  isPageLoading: boolean
  runLogs: string[]
  rawLogs: string[]
}) {
  const terminalLogCount = runLogs.length + rawLogs.length

  return (
    <div
      className="col-span-12 lg:col-span-4 flex flex-col overflow-hidden bg-[#0a0a0a]"
      data-testid="log-viewer-section"
    >
      <Tabs defaultValue="agent-tree" className="flex flex-col h-full overflow-hidden">
        <div className="flex-none border-b border-border/20 px-3 pt-1">
          <TabsList variant="line" className="gap-3">
            <TabsTrigger
              value="agent-tree"
              className="interactive-button flex items-center gap-1.5 text-xs"
            >
              <GitBranch className="size-3" aria-hidden="true" />
              Run Flow
            </TabsTrigger>
            <TabsTrigger value="mcp" className="interactive-button flex items-center gap-1.5 text-xs">
              <Network className="size-3" aria-hidden="true" />
              MCP
            </TabsTrigger>
            <TabsTrigger value="logs" className="interactive-button flex items-center gap-1.5 text-xs">
              <ScrollText className="size-3" aria-hidden="true" />
              Events
              <TabCount count={events.length} />
            </TabsTrigger>
            <TabsTrigger
              value="terminal"
              className="interactive-button flex items-center gap-1.5 text-xs"
            >
              <TerminalSquare className="size-3" aria-hidden="true" />
              Terminal
              <TabCount count={terminalLogCount} />
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="agent-tree" className="flex-1 min-h-0 overflow-hidden p-0 m-0">
          <AgentTree events={events} isActive={isActive} usage={usage} loading={isPageLoading} />
        </TabsContent>

        <TabsContent value="mcp" className="flex-1 min-h-0 overflow-hidden p-0 m-0">
          <MCPPanel events={events} loading={isPageLoading} />
        </TabsContent>

        <TabsContent value="logs" className="flex-1 min-h-0 overflow-hidden p-0 m-0">
          <LogViewer events={events} loading={isPageLoading} />
        </TabsContent>

        <TabsContent value="terminal" className="flex-1 min-h-0 overflow-hidden p-0 m-0">
          <LiveLogs runLogs={runLogs} rawLogs={rawLogs} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currentRun = useRunStore((state) => state.currentRun)
  const runHistory = useRunStore((state) => state.runHistory)
  const fetchHistory = useRunStore((state) => state.fetchHistory)
  const fetchRunEvents = useRunStore((state) => state.fetchRunEvents)
  const historicalRunEvents = useRunStore((state) => state.historicalRunEvents)
  const historyLoading = useRunStore((state) => state.historyLoading)
  const historicalEventsLoading = useRunStore((state) => state.historicalEventsLoading)
  const rawLogs = useRunStore((state) => state.rawLogs)
  const runLogs = useRunStore((state) => state.runLogs)
  const fetchLogs = useRunStore((state) => state.fetchLogs)

  const {
    isCurrentRun,
    hasHistoricalEvents,
    status,
    usage,
    events,
    isActive,
    startedAt,
    completedAt,
    isPageLoading,
  } = getRunDetailState({
    id,
    currentRun,
    runHistory,
    historicalRunEvents,
    historyLoading,
    historicalEventsLoading,
  })

  useEffect(() => {
    void fetchHistory()
  }, [fetchHistory])

  useEffect(() => {
    if (!shouldFetchHistoricalEvents(id, isCurrentRun, hasHistoricalEvents)) {
      return
    }

    void fetchRunEvents(id)
  }, [id, isCurrentRun, fetchRunEvents, hasHistoricalEvents])

  useEffect(() => {
    void fetchLogs()
    const intervalId = setInterval(() => void fetchLogs(), isActive ? 1500 : 5000)

    return () => clearInterval(intervalId)
  }, [fetchLogs, isActive])

  useEffect(() => {
    document.title = getRunDetailDocumentTitle(id, currentRun.run_id, currentRun.status)
  }, [id, currentRun.run_id, currentRun.status])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {isPageLoading ? (
        <RunDetailHeaderSkeleton />
      ) : (
        <RunDetailHeader
          runId={id ?? ''}
          status={status}
          startedAt={startedAt}
          completedAt={completedAt}
          usage={usage}
          isActive={isActive}
        />
      )}

      <div className="flex-1 overflow-hidden grid grid-cols-12">
        <EventTimelinePanel
          events={events}
          isActive={isActive}
          isPageLoading={isPageLoading}
          isCurrentRun={isCurrentRun}
          currentStage={currentRun.current_stage}
          currentAction={currentRun.current_action}
        />
        <RunDetailTabsPanel
          events={events}
          isActive={isActive}
          usage={usage}
          isPageLoading={isPageLoading}
          runLogs={runLogs}
          rawLogs={rawLogs}
        />
      </div>
    </div>
  )
}
