# Custom Tools

Build and integrate custom tools to extend Claude Agent SDK functionality

---

Custom tools allow you to extend Claude Code's capabilities with your own functionality through in-process MCP servers, enabling Claude to interact with external services, APIs, or perform specialized operations.

## Creating Custom Tools

Use the `createSdkMcpServer` and `tool` helper functions to define type-safe custom tools:

<CodeGroup>

```python Python
from claude_agent_sdk import tool, create_sdk_mcp_server, ClaudeSDKClient, ClaudeAgentOptions
from typing import Any
import aiohttp

# Define a custom tool using the @tool decorator
@tool("get_weather", "Get current temperature for a location using coordinates", {"latitude": float, "longitude": float})
async def get_weather(args: dict[str, Any]) -> dict[str, Any]:
    # Call weather API
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"https://api.open-meteo.com/v1/forecast?latitude={args['latitude']}&longitude={args['longitude']}&current=temperature_2m&temperature_unit=fahrenheit"
        ) as response:
            data = await response.json()

    return {
        "content": [{
            "type": "text",
            "text": f"Temperature: {data['current']['temperature_2m']}°F"
        }]
    }

# Create an SDK MCP server with the custom tool
custom_server = create_sdk_mcp_server(
    name="my-custom-tools",
    version="1.0.0",
    tools=[get_weather]  # Pass the decorated function
)
```

</CodeGroup>

## Using Custom Tools

Pass the custom server to the `query` function via the `mcpServers` option as a dictionary/object.

<Note>
**Important:** Custom MCP tools require streaming input mode. You must use an async generator/iterable for the `prompt` parameter - a simple string will not work with MCP servers.
</Note>

### Tool Name Format

When MCP tools are exposed to Claude, their names follow a specific format:
- Pattern: `mcp__{server_name}__{tool_name}`
- Example: A tool named `get_weather` in server `my-custom-tools` becomes `mcp__my-custom-tools__get_weather`

### Configuring Allowed Tools

You can control which tools Claude can use via the `allowedTools` option:

<CodeGroup>

```python Python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
import asyncio

# Use the custom tools with Claude
options = ClaudeAgentOptions(
    mcp_servers={"my-custom-tools": custom_server},
    allowed_tools=[
        "mcp__my-custom-tools__get_weather",  # Allow the weather tool
        # Add other tools as needed
    ]
)

async def main():
    async with ClaudeSDKClient(options=options) as client:
        await client.query("What's the weather in San Francisco?")

        # Extract and print response
        async for msg in client.receive_response():
            print(msg)

asyncio.run(main())
```

</CodeGroup>

### Multiple Tools Example

When your MCP server has multiple tools, you can selectively allow them:

<CodeGroup>

```python Python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, tool, create_sdk_mcp_server
from typing import Any
import asyncio

# Define multiple tools using the @tool decorator
@tool("calculate", "Perform calculations", {"expression": str})
async def calculate(args: dict[str, Any]) -> dict[str, Any]:
    result = eval(args["expression"])  # Use safe eval in production
    return {"content": [{"type": "text", "text": f"Result: {result}"}]}

@tool("translate", "Translate text", {"text": str, "target_lang": str})
async def translate(args: dict[str, Any]) -> dict[str, Any]:
    # Translation logic here
    return {"content": [{"type": "text", "text": f"Translated: {args['text']}"}]}

@tool("search_web", "Search the web", {"query": str})
async def search_web(args: dict[str, Any]) -> dict[str, Any]:
    # Search logic here
    return {"content": [{"type": "text", "text": f"Search results for: {args['query']}"}]}

multi_tool_server = create_sdk_mcp_server(
    name="utilities",
    version="1.0.0",
    tools=[calculate, translate, search_web]  # Pass decorated functions
)

# Allow only specific tools with streaming input
async def message_generator():
    yield {
        "type": "user",
        "message": {
            "role": "user",
            "content": "Calculate 5 + 3 and translate 'hello' to Spanish"
        }
    }

async for message in query(
    prompt=message_generator(),  # Use async generator for streaming input
    options=ClaudeAgentOptions(
        mcp_servers={"utilities": multi_tool_server},
        allowed_tools=[
            "mcp__utilities__calculate",   # Allow calculator
            "mcp__utilities__translate",   # Allow translator
            # "mcp__utilities__search_web" is NOT allowed
        ]
    )
):
    if hasattr(message, 'result'):
        print(message.result)
```

</CodeGroup>

## Type Safety with Python

The `@tool` decorator supports various schema definition approaches for type safety:

<CodeGroup>

```python Python
from typing import Any

# Simple type mapping - recommended for most cases
@tool(
    "process_data",
    "Process structured data with type safety",
    {
        "name": str,
        "age": int,
        "email": str,
        "preferences": list  # Optional parameters can be handled in the function
    }
)
async def process_data(args: dict[str, Any]) -> dict[str, Any]:
    # Access arguments with type hints for IDE support
    name = args["name"]
    age = args["age"]
    email = args["email"]
    preferences = args.get("preferences", [])

    print(f"Processing {name}'s data (age: {age})")

    return {
        "content": [{
            "type": "text",
            "text": f"Processed data for {name}"
        }]
    }

# For more complex schemas, you can use JSON Schema format
@tool(
    "advanced_process",
    "Process data with advanced validation",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "integer", "minimum": 0, "maximum": 150},
            "email": {"type": "string", "format": "email"},
            "format": {"type": "string", "enum": ["json", "csv", "xml"], "default": "json"}
        },
        "required": ["name", "age", "email"]
    }
)
async def advanced_process(args: dict[str, Any]) -> dict[str, Any]:
    # Process with advanced schema validation
    return {
        "content": [{
            "type": "text",
            "text": f"Advanced processing for {args['name']}"
        }]
    }
```

</CodeGroup>

## Error Handling

Handle errors gracefully to provide meaningful feedback:

<CodeGroup>

```python Python
import json
import aiohttp
from typing import Any

@tool(
    "fetch_data",
    "Fetch data from an API",
    {"endpoint": str}  # Simple schema
)
async def fetch_data(args: dict[str, Any]) -> dict[str, Any]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(args["endpoint"]) as response:
                if response.status != 200:
                    return {
                        "content": [{
                            "type": "text",
                            "text": f"API error: {response.status} {response.reason}"
                        }]
                    }

                data = await response.json()
                return {
                    "content": [{
                        "type": "text",
                        "text": json.dumps(data, indent=2)
                    }]
                }
    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": f"Failed to fetch data: {str(e)}"
            }]
        }
```

</CodeGroup>

## Example Tools

### Database Query Tool

<CodeGroup>

```python Python
from typing import Any
import json

@tool(
    "query_database",
    "Execute a database query",
    {"query": str, "params": list}  # Simple schema with list type
)
async def query_database(args: dict[str, Any]) -> dict[str, Any]:
    results = await db.query(args["query"], args.get("params", []))
    return {
        "content": [{
            "type": "text",
            "text": f"Found {len(results)} rows:\n{json.dumps(results, indent=2)}"
        }]
    }

database_server = create_sdk_mcp_server(
    name="database-tools",
    version="1.0.0",
    tools=[query_database]  # Pass the decorated function
)
```

</CodeGroup>

### API Gateway Tool

<CodeGroup>

```python Python
import os
import json
import aiohttp
from typing import Any

# For complex schemas with enums, use JSON Schema format
@tool(
    "api_request",
    "Make authenticated API requests to external services",
    {
        "type": "object",
        "properties": {
            "service": {"type": "string", "enum": ["stripe", "github", "openai", "slack"]},
            "endpoint": {"type": "string"},
            "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"]},
            "body": {"type": "object"},
            "query": {"type": "object"}
        },
        "required": ["service", "endpoint", "method"]
    }
)
async def api_request(args: dict[str, Any]) -> dict[str, Any]:
    config = {
        "stripe": {"base_url": "https://api.stripe.com/v1", "key": os.environ["STRIPE_KEY"]},
        "github": {"base_url": "https://api.github.com", "key": os.environ["GITHUB_TOKEN"]},
        "openai": {"base_url": "https://api.openai.com/v1", "key": os.environ["OPENAI_KEY"]},
        "slack": {"base_url": "https://slack.com/api", "key": os.environ["SLACK_TOKEN"]}
    }

    service_config = config[args["service"]]
    url = f"{service_config['base_url']}{args['endpoint']}"

    if args.get("query"):
        params = "&".join([f"{k}={v}" for k, v in args["query"].items()])
        url += f"?{params}"

    headers = {"Authorization": f"Bearer {service_config['key']}", "Content-Type": "application/json"}

    async with aiohttp.ClientSession() as session:
        async with session.request(
            args["method"], url, headers=headers, json=args.get("body")
        ) as response:
            data = await response.json()
            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps(data, indent=2)
                }]
            }

api_gateway_server = create_sdk_mcp_server(
    name="api-gateway",
    version="1.0.0",
    tools=[api_request]  # Pass the decorated function
)
```

</CodeGroup>

### Calculator Tool

<CodeGroup>

```python Python
import math
from typing import Any

@tool(
    "calculate",
    "Perform mathematical calculations",
    {"expression": str, "precision": int}  # Simple schema
)
async def calculate(args: dict[str, Any]) -> dict[str, Any]:
    try:
        # Use a safe math evaluation library in production
        result = eval(args["expression"], {"__builtins__": {}})
        precision = args.get("precision", 2)
        formatted = round(result, precision)

        return {
            "content": [{
                "type": "text",
                "text": f"{args['expression']} = {formatted}"
            }]
        }
    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": f"Error: Invalid expression - {str(e)}"
            }]
        }

@tool(
    "compound_interest",
    "Calculate compound interest for an investment",
    {"principal": float, "rate": float, "time": float, "n": int}
)
async def compound_interest(args: dict[str, Any]) -> dict[str, Any]:
    principal = args["principal"]
    rate = args["rate"]
    time = args["time"]
    n = args.get("n", 12)

    amount = principal * (1 + rate / n) ** (n * time)
    interest = amount - principal

    return {
        "content": [{
            "type": "text",
            "text": f"""Investment Analysis:
Principal: ${principal:.2f}
Rate: {rate * 100:.2f}%
Time: {time} years
Compounding: {n} times per year

Final Amount: ${amount:.2f}
Interest Earned: ${interest:.2f}
Return: {(interest / principal) * 100:.2f}%"""
        }]
    }

calculator_server = create_sdk_mcp_server(
    name="calculator",
    version="1.0.0",
    tools=[calculate, compound_interest]  # Pass decorated functions
)
```

</CodeGroup>

## Related Documentation

- [TypeScript SDK Reference](/docs/en/agent-sdk/typescript)
- [Python SDK Reference](/docs/en/agent-sdk/python)
- [MCP Documentation](https://modelcontextprotocol.io)
- [SDK Overview](/docs/en/agent-sdk/overview)
