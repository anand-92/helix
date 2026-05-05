"""Full retrieval pipeline for Helix's long-term memory.

Implements the read pipeline: build query → FTS5 candidate generation →
embed query (RETRIEVAL_QUERY) → cosine similarity scoring → score blending
(semantic*0.65 + lexical*0.20 + importance*0.10 + recency*0.05) → top-K
selection → access tracking → prompt injection formatting.

Supports cross-modal retrieval: text queries can match image/audio memories
in the unified Gemini embedding space.
"""

import math
from datetime import datetime, timezone
from typing import Any

import numpy as np
import structlog

from memory.embedder import EmbedTaskType, GeminiEmbedder
from memory.store import MemoryStore

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Defaults (overridable via constructor)
# ---------------------------------------------------------------------------

_DEFAULT_MAX_CANDIDATES = 50
_DEFAULT_MAX_INJECTED = 5
_DEFAULT_MAX_INJECTION_CHARS = 1200

# Score blending weights
_W_SEMANTIC = 0.65
_W_LEXICAL = 0.20
_W_IMPORTANCE = 0.10
_W_RECENCY = 0.05

# Recency half-life in days — after this many days the recency score drops to 0.5
_RECENCY_HALF_LIFE_DAYS = 30.0


# ---------------------------------------------------------------------------
# MemoryRetriever
# ---------------------------------------------------------------------------


class MemoryRetriever:
    """Retrieval pipeline combining FTS5 lexical search with semantic reranking.

    Parameters
    ----------
    store : MemoryStore
        Initialised memory store with schema.
    embedder : GeminiEmbedder
        Gemini embedding client (calls will be mocked in tests).
    max_candidates : int
        Maximum FTS5 candidates to retrieve (default 50).
    max_injected : int
        Maximum memories to inject into the prompt (default 5).
    max_injection_chars : int
        Maximum total characters in the injection text (default ~1200).
    """

    def __init__(
        self,
        store: MemoryStore,
        embedder: GeminiEmbedder,
        *,
        max_candidates: int = _DEFAULT_MAX_CANDIDATES,
        max_injected: int = _DEFAULT_MAX_INJECTED,
        max_injection_chars: int = _DEFAULT_MAX_INJECTION_CHARS,
    ) -> None:
        self._store = store
        self._embedder = embedder
        self._max_candidates = max_candidates
        self._max_injected = max_injected
        self._max_injection_chars = max_injection_chars

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def retrieve(
        self,
        query_text: str,
        *,
        action_id: str,
        global_prompt: str | None = None,
        action_prompt: str | None = None,
        max_override: int | None = None,
        kind_filter: str | None = None,
    ) -> str:
        """Run the full retrieval pipeline and return formatted injection text.

        Returns an empty string if no relevant memories are found or if the
        store is empty.  Never raises — errors are logged and swallowed.

        Parameters
        ----------
        query_text : str
            Raw query text (e.g. the per-action prompt or a user question).
        action_id : str
            ID of the action requesting memory retrieval.
        global_prompt : str, optional
            Global run prompt for context enrichment.
        action_prompt : str, optional
            Per-action prompt for context enrichment.

        Returns
        -------
        str
            Formatted prompt injection block, or empty string.
        """
        try:
            return await self._retrieve_inner(
                query_text,
                action_id=action_id,
                global_prompt=global_prompt,
                action_prompt=action_prompt,
                max_override=max_override,
                kind_filter=kind_filter,
            )
        except Exception:
            logger.error("Memory retrieval failed — continuing without memory", exc_info=True)
            return ""

    def build_query(
        self,
        action_id: str,
        global_prompt: str | None = None,
        action_prompt: str | None = None,
    ) -> str:
        """Compose a retrieval query from action context parts.

        Combines the action ID, global prompt, and per-action prompt
        into a single query string used for both FTS5 and embedding.
        """
        parts: list[str] = [action_id]
        if global_prompt:
            parts.append(global_prompt)
        if action_prompt:
            parts.append(action_prompt)
        return " ".join(parts)

    # ------------------------------------------------------------------
    # Score helpers (exposed for testing)
    # ------------------------------------------------------------------

    @staticmethod
    def _cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors.

        Both vectors should be L2-normalized for best results, but the
        function handles un-normalized vectors correctly.

        Returns a value in [-1, 1].
        """
        dot = float(np.dot(vec_a, vec_b))
        norm_a = float(np.linalg.norm(vec_a))
        norm_b = float(np.linalg.norm(vec_b))
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return dot / (norm_a * norm_b)

    @staticmethod
    def _blend_scores(
        *,
        semantic_score: float,
        lexical_score: float,
        importance: float,
        recency_score: float,
    ) -> float:
        """Compute blended score from the four components.

        Formula: semantic*0.65 + lexical*0.20 + importance*0.10 + recency*0.05
        """
        return (
            semantic_score * _W_SEMANTIC
            + lexical_score * _W_LEXICAL
            + importance * _W_IMPORTANCE
            + recency_score * _W_RECENCY
        )

    @staticmethod
    def _recency_score(created_at_iso: str) -> float:
        """Compute a time-decay recency score in [0, 1].

        Uses exponential decay with a half-life of 30 days.
        A memory created just now scores ~1.0; after 30 days ~0.5; etc.
        """
        try:
            created = datetime.fromisoformat(created_at_iso)
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            age_days = max((now - created).total_seconds() / 86400.0, 0.0)
            # Exponential decay: score = 2^(-age / half_life)
            return math.pow(2.0, -age_days / _RECENCY_HALF_LIFE_DAYS)
        except Exception:
            return 0.5  # Fallback for unparseable timestamps

    @staticmethod
    def _normalize_fts_ranks(ranks: list[float]) -> list[float]:
        """Normalize FTS5 rank values to [0, 1].

        FTS5 ranks are negative (more negative = better match).
        The best rank maps to 1.0, the worst to ~0.0.
        """
        if not ranks:
            return []
        if len(ranks) == 1:
            return [1.0]

        # FTS5 ranks are negative; invert so more negative → higher score
        min_rank = min(ranks)  # Most negative = best match
        max_rank = max(ranks)  # Least negative = worst match

        if min_rank == max_rank:
            return [1.0] * len(ranks)

        span = max_rank - min_rank
        # Invert: best (most negative) → 1.0, worst (least negative) → 0.0
        return [(max_rank - r) / span for r in ranks]

    # ------------------------------------------------------------------
    # FTS5 helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_fts_query(text: str) -> str:
        """Convert a plain-text query into an FTS5 OR expression.

        Tokenises the text into words, escapes each for FTS5, and joins
        them with OR so that a match on *any* term returns a candidate.
        """
        # Remove special FTS5 characters and split on whitespace
        words: list[str] = []
        for word in text.split():
            # Keep only alphanumeric characters (strip punctuation)
            cleaned = "".join(c for c in word if c.isalnum())
            if cleaned:
                words.append(f'"{cleaned}"')

        if not words:
            return text

        return " OR ".join(words)

    def _fts_search(
        self,
        fts_query: str,
        *,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Search the FTS5 index with a pre-built query expression."""
        try:
            return self._store.search_fts_raw(fts_query, limit=limit)
        except Exception:
            logger.error("FTS5 search failed", exc_info=True)
            return []

    # ------------------------------------------------------------------
    # Internal pipeline
    # ------------------------------------------------------------------

    async def _retrieve_inner(
        self,
        query_text: str,
        *,
        action_id: str,
        global_prompt: str | None = None,
        action_prompt: str | None = None,
        max_override: int | None = None,
        kind_filter: str | None = None,
    ) -> str:
        """Core retrieval logic (may raise on errors)."""

        # 1. Build composed query (combines action context with query text)
        composed_query = self.build_query(action_id, global_prompt, action_prompt)
        # Incorporate the raw query_text if not already part of the composed query
        if query_text and query_text not in composed_query:
            full_query = f"{composed_query} {query_text}"
        else:
            full_query = composed_query

        # 2. FTS5 candidate generation — use OR-joined terms for broader recall
        fts_query = self._build_fts_query(full_query)
        candidates = self._fts_search(fts_query, limit=self._max_candidates)
        if not candidates:
            return ""

        # 2b. Optional kind filter (used by the recall tool)
        if kind_filter:
            candidates = [c for c in candidates if c.get("kind") == kind_filter]
            if not candidates:
                return ""

        # 3. Embed query with RETRIEVAL_QUERY task type
        query_vector = await self._embedder.embed_text(
            full_query,
            task_type=EmbedTaskType.RETRIEVAL_QUERY,
        )

        # 4. Load candidate embeddings and compute scores
        scored: list[tuple[float, dict[str, Any]]] = []
        fts_ranks = [float(c.get("rank", 0.0)) for c in candidates]
        normalized_lexical = self._normalize_fts_ranks(fts_ranks)

        for idx, candidate in enumerate(candidates):
            mem_id = candidate["id"]

            # Semantic score: cosine similarity against candidate vector
            semantic = 0.0
            if query_vector is not None:
                emb = self._store.get_embedding(mem_id, task_type="RETRIEVAL_DOCUMENT")
                if emb is not None and "vector" in emb:
                    candidate_vec = np.array(emb["vector"], dtype=np.float64)
                    semantic = self._cosine_similarity(query_vector, candidate_vec)
                    # Clamp to [0, 1] for blending (negative similarity → 0)
                    semantic = max(semantic, 0.0)

            lexical = normalized_lexical[idx]
            importance = float(candidate.get("importance", 0.5))
            recency = self._recency_score(candidate.get("created_at", ""))

            blended = self._blend_scores(
                semantic_score=semantic,
                lexical_score=lexical,
                importance=importance,
                recency_score=recency,
            )

            scored.append((blended, candidate))

        # 5. Sort by blended score descending and select top-K
        scored.sort(key=lambda x: x[0], reverse=True)
        effective_max = max_override if max_override is not None else self._max_injected
        top_memories = scored[:effective_max]

        if not top_memories:
            return ""

        # 6. Update access tracking for retrieved memories
        self._update_access_tracking([mem for _, mem in top_memories])

        # 7. Format as prompt injection
        return self._format_injection([mem for _, mem in top_memories])

    # ------------------------------------------------------------------
    # Access tracking
    # ------------------------------------------------------------------

    def _update_access_tracking(self, memories: list[dict[str, Any]]) -> None:
        """Increment access_count and set last_accessed_at for retrieved memories."""
        now = datetime.now(timezone.utc).isoformat()
        for mem in memories:
            current_count = mem.get("access_count", 0)
            self._store.update_memory(
                mem["id"],
                access_count=current_count + 1,
                last_accessed_at=now,
            )

    # ------------------------------------------------------------------
    # Prompt injection formatting
    # ------------------------------------------------------------------

    def _format_injection(self, memories: list[dict[str, Any]]) -> str:
        """Format retrieved memories as compact prompt injection text.

        Format:
            Relevant long-term memory:
            - [kind] summary_or_content

        Prefers summary over content when available.
        Respects the max injection character limit (~1200 chars).
        """
        header = "Relevant long-term memory:"
        lines: list[str] = []
        total_chars = len(header) + 1  # +1 for the trailing newline

        for mem in memories:
            kind = mem.get("kind", "unknown")
            # Prefer summary over content
            text = mem.get("summary") if mem.get("summary") else mem.get("content", "")
            text = text if text is not None else ""

            # Truncate individual memory text to keep within budget
            max_per_line = min(
                200, self._max_injection_chars - total_chars - len(f"- [{kind}] ") - 1
            )
            if max_per_line <= 0:
                break

            if len(text) > max_per_line:
                text = text[:max_per_line].rstrip() + "..."

            line = f"- [{kind}] {text}"
            line_len = len(line) + 1  # +1 for newline

            if total_chars + line_len > self._max_injection_chars:
                # Try to fit a truncated version
                remaining = (
                    self._max_injection_chars - total_chars - len(f"- [{kind}] ") - 4
                )  # "...\n"
                if remaining > 10:
                    line = f"- [{kind}] {text[:remaining].rstrip()}..."
                    lines.append(line)
                break

            lines.append(line)
            total_chars += line_len

        if not lines:
            return ""

        return header + "\n" + "\n".join(lines)
