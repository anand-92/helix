/**
 * Skill detection utilities for tool call events.
 *
 * A tool call is classified as a skill invocation when its tool_name:
 *   1. Starts with 'Skill' (e.g. "Skill", "Skill__frontend-worker") — the
 *      Claude Agent SDK uses this prefix for skill tool invocations.
 *   2. Matches a known skill name exactly.
 */

/** Recognised skill names in the agent pipeline. */
export const KNOWN_SKILL_NAMES = [
  'find-skills',
] as const

const KNOWN_SKILL_NAMES_SET = new Set<string>(KNOWN_SKILL_NAMES)

/**
 * Returns true when the given tool_name represents a skill invocation.
 *
 * Detection rules (checked in order):
 *   1. Exact match "Skill" (bare SDK skill invocation)
 *   2. Starts with "Skill__" (namespaced skill: "Skill__frontend-worker")
 *   3. Present in KNOWN_SKILL_NAMES (direct skill name as tool_name)
 */
export function isSkillToolCall(toolName: string): boolean {
  if (!toolName) return false
  if (toolName === 'Skill' || toolName.startsWith('Skill__')) return true
  return KNOWN_SKILL_NAMES_SET.has(toolName)
}

/**
 * Extracts a human-readable display name from a skill tool_name.
 *
 * Examples:
 *   "Skill"                  → "Skill"
 *   "Skill__frontend-worker" → "frontend-worker"
 *   "frontend-worker"        → "frontend-worker"  (direct known-name match)
 */
export function getSkillDisplayName(toolName: string): string {
  if (toolName.startsWith('Skill__')) {
    return toolName.slice('Skill__'.length)
  }
  return toolName
}
