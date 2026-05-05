# Tracking Costs and Usage

Understand and track token usage for billing in the Claude Agent SDK

---

# SDK Cost Tracking

The Claude Agent SDK provides detailed token usage information for each interaction with Claude. This guide explains how to properly track costs and understand usage reporting, especially when dealing with parallel tool uses and multi-step conversations.

For complete API documentation, see the [TypeScript SDK reference](/docs/en/agent-sdk/typescript).

## Understanding Token Usage

When Claude processes requests, it reports token usage at the message level. This usage data is essential for tracking costs and billing users appropriately.

### Key Concepts

1. **Steps**: A step is a single request/response pair between your application and Claude
2. **Messages**: Individual messages within a step (text, tool uses, tool results)
3. **Usage**: Token consumption data attached to assistant messages

## Usage Reporting Structure

### Single vs Parallel Tool Use

When Claude executes tools, the usage reporting differs based on whether tools are executed sequentially or in parallel:

<CodeGroup>

```python Python
from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage
import asyncio

# Example: Tracking usage in a conversation
async def track_usage():
    # Process messages as they arrive
    async for message in query(
        prompt="Analyze this codebase and run tests"
    ):
        if isinstance(message, AssistantMessage) and hasattr(message, 'usage'):
            print(f"Message ID: {message.id}")
            print(f"Usage: {message.usage}")

asyncio.run(track_usage())
```

</CodeGroup>

### Message Flow Example

Here's how messages and usage are reported in a typical multi-step conversation:

```
<!-- Step 1: Initial request with parallel tool uses -->
assistant (text)      { id: "msg_1", usage: { output_tokens: 100, ... } }
assistant (tool_use)  { id: "msg_1", usage: { output_tokens: 100, ... } }
assistant (tool_use)  { id: "msg_1", usage: { output_tokens: 100, ... } }
assistant (tool_use)  { id: "msg_1", usage: { output_tokens: 100, ... } }
user (tool_result)
user (tool_result)
user (tool_result)

<!-- Step 2: Follow-up response -->
assistant (text)      { id: "msg_2", usage: { output_tokens: 98, ... } }
```

## Important Usage Rules

### 1. Same ID = Same Usage

**All messages with the same `id` field report identical usage**. When Claude sends multiple messages in the same turn (e.g., text + tool uses), they share the same message ID and usage data.

### 2. Charge Once Per Step

**You should only charge users once per step**, not for each individual message. When you see multiple assistant messages with the same ID, use the usage from any one of them.

### 3. Result Message Contains Cumulative Usage

The final `result` message contains the total cumulative usage from all steps in the conversation:

## Implementation: Cost Tracking System

Here's a complete example of implementing a cost tracking system:

<CodeGroup>

```python Python
from claude_agent_sdk import query, AssistantMessage, ResultMessage
from datetime import datetime
import asyncio

class CostTracker:
    def __init__(self):
        self.processed_message_ids = set()
        self.step_usages = []

    async def track_conversation(self, prompt):
        result = None

        # Process messages as they arrive
        async for message in query(prompt=prompt):
            self.process_message(message)

            # Capture the final result message
            if isinstance(message, ResultMessage):
                result = message

        return {
            "result": result,
            "step_usages": self.step_usages,
            "total_cost": result.total_cost_usd if result else 0
        }

    def process_message(self, message):
        # Only process assistant messages with usage
        if not isinstance(message, AssistantMessage) or not hasattr(message, 'usage'):
            return

        # Skip if already processed this message ID
        message_id = getattr(message, 'message_id', None)
        if not message_id or message_id in self.processed_message_ids:
            return

        # Mark as processed and record usage
        self.processed_message_ids.add(message_id)
        self.step_usages.append({
            "message_id": message_id,
            "timestamp": datetime.now().isoformat(),
            "usage": message.usage,
            "cost_usd": self.calculate_cost(message.usage)
        })

    def calculate_cost(self, usage):
        # Implement your pricing calculation
        input_cost = usage.get("input_tokens", 0) * 0.00003
        output_cost = usage.get("output_tokens", 0) * 0.00015
        cache_read_cost = usage.get("cache_read_input_tokens", 0) * 0.0000075

        return input_cost + output_cost + cache_read_cost

# Usage
async def main():
    tracker = CostTracker()
    result = await tracker.track_conversation("Analyze and refactor this code")

    print(f"Steps processed: {len(result['step_usages'])}")
    print(f"Total cost: ${result['total_cost']:.4f}")

asyncio.run(main())
```

</CodeGroup>

## Handling Edge Cases

### Output Token Discrepancies

In rare cases, you might observe different `output_tokens` values for messages with the same ID. When this occurs:

1. **Use the highest value** - The final message in a group typically contains the accurate total
2. **Verify against total cost** - The `total_cost_usd` in the result message is authoritative
3. **Report inconsistencies** - File issues at the [Claude Code GitHub repository](https://github.com/anthropics/claude-code/issues)

### Cache Token Tracking

When using prompt caching, track these token types separately:

## Best Practices

1. **Use Message IDs for Deduplication**: Always track processed message IDs to avoid double-charging
2. **Monitor the Result Message**: The final result contains authoritative cumulative usage
3. **Implement Logging**: Log all usage data for auditing and debugging
4. **Handle Failures Gracefully**: Track partial usage even if a conversation fails
5. **Consider Streaming**: For streaming responses, accumulate usage as messages arrive

## Usage Fields Reference

Each usage object contains:

- `input_tokens`: Base input tokens processed
- `output_tokens`: Tokens generated in the response
- `cache_creation_input_tokens`: Tokens used to create cache entries
- `cache_read_input_tokens`: Tokens read from cache
- `service_tier`: The service tier used (e.g., "standard")
- `total_cost_usd`: Total cost in USD (only in result message)

## Example: Building a Billing Dashboard

Here's how to aggregate usage data for a billing dashboard:

## Related Documentation

- [TypeScript SDK Reference](/docs/en/agent-sdk/typescript) - Complete API documentation
- [SDK Overview](/docs/en/agent-sdk/overview) - Getting started with the SDK
- [SDK Permissions](/docs/en/agent-sdk/permissions) - Managing tool permissions
