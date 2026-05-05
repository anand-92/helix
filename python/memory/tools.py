"""Custom MCP tools that give Helix direct control over its memory.

Exposes three tools via an in-process SDK MCP server:
  - recall:      Search long-term memory on demand
  - remember:    Store a memory explicitly mid-action
  - verify_fact: Verify a claim against stored fact memories

Usage:
    server = create_memory_mcp_server(memory_service)
    # Pass to ClaudeAgentOptions(mcp_servers={"agent-memory": server})
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING, Any

import structlog
from claude_agent_sdk import create_sdk_mcp_server, tool

if TYPE_CHECKING:
    from memory.service import MemoryService

logger = structlog.get_logger(__name__)

_VALID_KINDS = frozenset({"fact", "preference", "goal", "entity", "episode"})

MEMORY_MCP_SERVER_NAME = "agent-memory"

MEMORY_TOOL_NAMES = [
    f"mcp__{MEMORY_MCP_SERVER_NAME}__recall",
    f"mcp__{MEMORY_MCP_SERVER_NAME}__remember",
    f"mcp__{MEMORY_MCP_SERVER_NAME}__verify_fact",
]


def create_memory_mcp_server(memory_service: MemoryService) -> Any:
    """Build an SDK MCP server with memory tools bound to *memory_service*."""

    @tool(
        "recall",
        "Search your long-term memory for relevant information. Use when you need "
        "context from past runs, interactions, or stored knowledge. Returns formatted "
        "memory entries ranked by relevance.",
        {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to search for — be specific and descriptive",
                },
                "kind": {
                    "type": "string",
                    "enum": ["fact", "preference", "goal", "entity", "episode"],
                    "description": "Optional: filter to a specific memory category",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max memories to return (default 5, max 10)",
                    "default": 5,
                    "minimum": 1,
                    "maximum": 10,
                },
            },
            "required": ["query"],
        },
    )
    async def recall(args: dict[str, Any]) -> dict[str, Any]:
        query = args["query"]
        kind = args.get("kind")
        limit = min(args.get("limit", 5), 10)

        result = await memory_service._retriever.retrieve(
            query,
            action_id="recall_tool",
            max_override=limit,
            kind_filter=kind,
        )

        if not result:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": "No relevant memories found.",
                    }
                ]
            }

        return {"content": [{"type": "text", "text": result}]}

    @tool(
        "remember",
        "Store an important memory for future recall across runs. Use when you "
        "learn something worth retaining — a fact, preference, goal, or entity. "
        "Memories you store explicitly are higher confidence than auto-extracted ones.",
        {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The memory content to store — be clear and specific",
                },
                "kind": {
                    "type": "string",
                    "enum": ["fact", "preference", "goal", "entity", "episode"],
                    "description": "Category: fact, preference, goal, entity, or episode",
                },
                "importance": {
                    "type": "number",
                    "description": "How important is this (0.0-1.0, default 0.7)",
                    "default": 0.7,
                    "minimum": 0.0,
                    "maximum": 1.0,
                },
            },
            "required": ["content", "kind"],
        },
    )
    async def remember(args: dict[str, Any]) -> dict[str, Any]:
        content = args["content"].strip()
        kind = args["kind"]
        importance = max(0.0, min(1.0, args.get("importance", 0.7)))

        if kind not in _VALID_KINDS:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Invalid kind '{kind}'. Must be one of: {', '.join(sorted(_VALID_KINDS))}",
                    }
                ]
            }

        if not content:
            return {"content": [{"type": "text", "text": "Cannot store empty memory."}]}

        try:
            fingerprint = hashlib.sha256(content.lower().encode()).hexdigest()

            memory = memory_service._store.create_memory(
                kind=kind,
                modality="text",
                content=content,
                importance=importance,
                confidence=0.95,
                fingerprint=fingerprint,
                source_action_id="remember_tool",
            )

            memory_id = memory["id"]

            # Embed and store the vector for future retrieval
            await memory_service._try_embed_and_store(memory_id, {"content": content})

            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Stored [{kind}] memory (id: {memory_id[:8]}): {content[:80]}",
                    }
                ]
            }
        except Exception as exc:
            logger.error("remember_tool_failed", error=str(exc), exc_info=True)
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Failed to store memory: {exc}",
                    }
                ]
            }

    @tool(
        "verify_fact",
        "Check a claim against your stored fact memories. Returns whether "
        "the claim is confirmed, unverified, or if there's insufficient data.",
        {
            "type": "object",
            "properties": {
                "claim": {
                    "type": "string",
                    "description": "The factual claim to verify",
                },
            },
            "required": ["claim"],
        },
    )
    async def verify_fact_tool(args: dict[str, Any]) -> dict[str, Any]:
        claim = args["claim"]

        try:
            result = await memory_service.verify_fact(claim)
        except Exception as exc:
            logger.error("verify_fact_tool_failed", error=str(exc), exc_info=True)
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Verification failed: {exc}",
                    }
                ]
            }

        status = result.get("status", "unverified")
        similarity = result.get("similarity")
        matched = result.get("matched_content")

        parts = [f"Status: {status}"]
        if similarity is not None:
            parts.append(f"Similarity: {similarity:.2f}")
        if matched:
            parts.append(f"Matched: {matched[:120]}")

        return {"content": [{"type": "text", "text": "\n".join(parts)}]}

    return create_sdk_mcp_server(
        name=MEMORY_MCP_SERVER_NAME,
        version="1.0.0",
        tools=[recall, remember, verify_fact_tool],
    )
