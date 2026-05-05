import type { RunEvent } from '@/types/run'

export const MEMORY_MCP_SERVER_NAME = 'agent-memory'
const MEMORY_TOOL_CALL_PREFIX = `mcp__${MEMORY_MCP_SERVER_NAME}__`

export function isMemoryToolCall(toolName: string): boolean {
  return toolName.startsWith(MEMORY_TOOL_CALL_PREFIX)
}

export function isMemoryMcpServer(serverName: string): boolean {
  return serverName === MEMORY_MCP_SERVER_NAME
}

export function isMemoryEvent(event: RunEvent): boolean {
  const toolName = typeof event.payload.tool_name === 'string' ? event.payload.tool_name : ''
  const serverName = typeof event.payload.server_name === 'string' ? event.payload.server_name : ''

  return isMemoryToolCall(toolName) || isMemoryMcpServer(serverName)
}
