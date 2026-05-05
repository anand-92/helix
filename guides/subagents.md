# Subagents in the SDK

Working with subagents in the Claude Agent SDK

---

Subagents in the Claude Agent SDK are specialized AIs that are orchestrated by the main agent.
Use subagents for context management and parallelization.

This guide explains how to define and use subagents in the SDK using the `agents` parameter.

## Overview

Subagents can be defined in two ways when using the SDK:

1. **Programmatically** - Using the `agents` parameter in your `query()` options (recommended for SDK applications)
2. **Filesystem-based** - Placing markdown files with YAML frontmatter in designated directories (`.claude/agents/`)

This guide primarily focuses on the programmatic approach using the `agents` parameter, which provides a more integrated development experience for SDK applications.

## Benefits of Using Subagents

### Context Management
Subagents maintain separate context from the main agent, preventing information overload and keeping interactions focused. This isolation ensures that specialized tasks don't pollute the main conversation context with irrelevant details.

**Example**: A `research-assistant` subagent can explore dozens of files and documentation pages without cluttering the main conversation with all the intermediate search results - only returning the relevant findings.

### Parallelization
Multiple subagents can run concurrently, dramatically speeding up complex workflows.

**Example**: During a code review, you can run `style-checker`, `security-scanner`, and `test-coverage` subagents simultaneously, reducing review time from minutes to seconds.

### Specialized Instructions and Knowledge
Each subagent can have tailored system prompts with specific expertise, best practices, and constraints.

**Example**: A `database-migration` subagent can have detailed knowledge about SQL best practices, rollback strategies, and data integrity checks that would be unnecessary noise in the main agent's instructions.

### Tool Restrictions
Subagents can be limited to specific tools, reducing the risk of unintended actions.

**Example**: A `doc-reviewer` subagent might only have access to Read and Grep tools, ensuring it can analyze but never accidentally modify your documentation files.

## Creating Subagents

### Programmatic Definition (Recommended)

Define subagents directly in your code using the `agents` parameter.

### AgentDefinition Configuration

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `description` | `string` | Yes | Natural language description of when to use this agent |
| `prompt` | `string` | Yes | The agent's system prompt defining its role and behavior |
| `tools` | `string[]` | No | Array of allowed tool names. If omitted, inherits all tools |
| `model` | `'sonnet' \| 'opus' \| 'haiku' \| 'inherit'` | No | Model override for this agent. Defaults to main model if omitted |

### Filesystem-Based Definition (Alternative)

You can also define subagents as markdown files in specific directories:

- **Project-level**: `.claude/agents/*.md` - Available only in the current project
- **User-level**: `~/.claude/agents/*.md` - Available across all projects

Each subagent is a markdown file with YAML frontmatter:

```markdown
---
name: code-reviewer
description: Expert code review specialist. Use for quality, security, and maintainability reviews.
tools: Read, Grep, Glob, Bash
---

Your subagent's system prompt goes here. This defines the subagent's
role, capabilities, and approach to solving problems.
```

**Note:** Programmatically defined agents (via the `agents` parameter) take precedence over filesystem-based agents with the same name.

## How the SDK Uses Subagents

When using the Claude Agent SDK, subagents can be defined programmatically or loaded from the filesystem. Claude will:

1. **Load programmatic agents** from the `agents` parameter in your options
2. **Auto-detect filesystem agents** from `.claude/agents/` directories (if not overridden)
3. **Invoke them automatically** based on task matching and the agent's `description`
4. **Use their specialized prompts** and tool restrictions
5. **Maintain separate context** for each subagent invocation

Programmatically defined agents (via `agents` parameter) take precedence over filesystem-based agents with the same name.

## Example Subagents

For comprehensive examples of subagents including code reviewers, test runners, debuggers, and security auditors, see the [main Subagents guide](https://code.claude.com/docs/en/sub-agents#example-subagents). The guide includes detailed configurations and best practices for creating effective subagents.

## SDK Integration Patterns

### Automatic Invocation

The SDK will automatically invoke appropriate subagents based on the task context. Ensure your agent's `description` field clearly indicates when it should be used.

### Explicit Invocation

Users can request specific subagents in their prompts.

### Dynamic Agent Configuration

You can dynamically configure agents based on your application's needs.

## Tool Restrictions

Subagents can have restricted tool access via the `tools` field:

- **Omit the field** - Agent inherits all available tools (default)
- **Specify tools** - Agent can only use listed tools

Example of a read-only analysis agent:

### Common Tool Combinations

**Read-only agents** (analysis, review):
`tools: ['Read', 'Grep', 'Glob']`

**Test execution agents**:
`tools: ['Bash', 'Read', 'Grep']`

**Code modification agents**:
`tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob']`

## Related Documentation

- [Main Subagents Guide](https://code.claude.com/docs/en/sub-agents) - Comprehensive subagent documentation
- [SDK Overview](/docs/en/agent-sdk/overview) - Overview of Claude Agent SDK
- [Settings](https://code.claude.com/docs/en/settings) - Configuration file reference
- [Slash Commands](https://code.claude.com/docs/en/slash-commands) - Custom command creation
