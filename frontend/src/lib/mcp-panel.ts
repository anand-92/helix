/**
 * mcp-panel.ts — Pure utility for building MCP server/tool usage data
 * from raw RunEvent arrays.
 *
 * Derives data from MCPToolEvent events (event_type === 'mcp_tool').
 * Groups by server_name, then by tool_name.
 *
 * Data structure:
 *   MCPServerInfo    — one entry per unique server_name in the events
 *     MCPToolInfo    — one entry per unique tool_name within that server
 */

import type { RunEvent } from '@/types/run'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPToolInfo {
  /** Name of the tool as reported by the MCP server. */
  toolName: string
  /** Number of times this tool was invoked during the run. */
  callCount: number
  /** ISO-8601 timestamp of the most recent invocation, or null if none. */
  lastUsed: string | null
}

export interface MCPServerInfo {
  /** MCP server name (e.g. "memory"). */
  serverName: string
  /**
   * "active"   — at least one tool call event recorded for this server.
   * "inactive" — server entry exists but no call events (future: pre-populated from config).
   */
  status: 'active' | 'inactive'
  /** Total number of distinct tools called on this server. */
  toolCount: number
  /** Per-tool call counts and timestamps. */
  tools: MCPToolInfo[]
}

// ---------------------------------------------------------------------------
// buildMCPData
// ---------------------------------------------------------------------------

/**
 * Build an array of MCPServerInfo from a flat array of RunEvents.
 *
 * Only `mcp_tool` events are considered.
 * Returns an empty array when no MCP tool events exist.
 *
 * @param events - Flat array of events from the store (any order).
 * @returns      Array of MCPServerInfo, sorted alphabetically by serverName.
 */
export function buildMCPData(events: RunEvent[]): MCPServerInfo[] {
  // Filter to mcp_tool events only
  const mcpEvents = events.filter((e) => e.event_type === 'mcp_tool')

  if (mcpEvents.length === 0) return []

  // Group by server_name
  // Map: serverName → (toolName → {callCount, lastUsed})
  const serverMap = new Map<string, Map<string, { callCount: number; lastUsed: string | null }>>()

  for (const event of mcpEvents) {
    const serverName =
      typeof event.payload.server_name === 'string' && event.payload.server_name.length > 0
        ? event.payload.server_name
        : 'unknown'
    const toolName =
      typeof event.payload.tool_name === 'string' && event.payload.tool_name.length > 0
        ? event.payload.tool_name
        : 'unknown'
    const timestamp = event.timestamp

    // Ensure server entry exists
    if (!serverMap.has(serverName)) {
      serverMap.set(serverName, new Map())
    }
    const toolMap = serverMap.get(serverName)!

    // Update tool entry
    if (!toolMap.has(toolName)) {
      toolMap.set(toolName, { callCount: 0, lastUsed: null })
    }
    const toolEntry = toolMap.get(toolName)!
    toolEntry.callCount += 1

    // Track the most recent invocation
    if (
      toolEntry.lastUsed === null ||
      new Date(timestamp).getTime() > new Date(toolEntry.lastUsed).getTime()
    ) {
      toolEntry.lastUsed = timestamp
    }
  }

  // Convert to sorted output
  const result: MCPServerInfo[] = []

  for (const [serverName, toolMap] of serverMap) {
    const tools: MCPToolInfo[] = []

    for (const [toolName, info] of toolMap) {
      tools.push({
        toolName,
        callCount: info.callCount,
        lastUsed: info.lastUsed,
      })
    }

    // Sort tools alphabetically
    tools.sort((a, b) => a.toolName.localeCompare(b.toolName))

    result.push({
      serverName,
      status: tools.length > 0 ? 'active' : 'inactive',
      toolCount: tools.length,
      tools,
    })
  }

  // Sort servers alphabetically
  result.sort((a, b) => a.serverName.localeCompare(b.serverName))

  return result
}
