"""Hello action definition."""

from claude_agent_sdk import AgentDefinition

HELLO_ACTION = AgentDefinition(
    description="""Greeting specialist. Returns a short hello message.""",
    prompt="""Create a short hello message for terminal output. This is the first thing a user sees when a run starts.

- 1-2 sentences max. This is a terminal greeting, not a conversation.
- Be friendly but concise.

Return only the message text.
""",
    tools=["Bash", "Skill"],
)
