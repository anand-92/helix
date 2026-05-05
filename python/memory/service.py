"""Orchestration facade for Helix's long-term memory subsystem.

Combines store, embedder, media manager, retriever, and extractor into
a single interface used by the orchestrator.  All public methods handle
errors gracefully — memory failures never crash the action runtime.
"""

from pathlib import Path

import numpy as np
import structlog
from sklearn.cluster import AgglomerativeClustering

from memory.embedder import EmbedTaskType, GeminiEmbedder
from memory.extractor import MemoryExtractor
from memory.media import MediaManager
from memory.retriever import MemoryRetriever
from memory.store import MemoryStore

logger = structlog.get_logger(__name__)


class MemoryService:
    """High-level facade that wires all memory sub-components together.

    Parameters
    ----------
    db_path : Path | str
        SQLite database file path.
    api_key : str
        Gemini API key for the embedder.
    media_dir : Path | str
        Directory for storing large media files on disk.
    dimensions : int
        Embedding dimensionality (default 768).
    max_candidates : int
        Maximum FTS5 candidates for retrieval (default 50).
    max_injected : int
        Maximum memories to inject into action prompts (default 5).
    dedup_threshold : float
        Cosine similarity threshold for semantic deduplication (default 0.92).
    embed_model : str
        Gemini embedding model identifier.
    inline_max_bytes : int
        Maximum file size for inline blob storage in the DB (default 256KB).
    """

    def __init__(
        self,
        db_path: Path | str,
        api_key: str,
        media_dir: Path | str,
        *,
        dimensions: int = 768,
        max_candidates: int = 50,
        max_injected: int = 5,
        dedup_threshold: float = 0.92,
        consolidation_similarity_threshold: float | None = None,
        consolidation_run_interval: int = 0,
        fact_confirm_threshold: float = 0.85,
        embed_model: str = "gemini-embedding-2-preview",
        inline_max_bytes: int = 262144,
    ) -> None:
        # --- Sub-components -------------------------------------------------
        self._store = MemoryStore(db_path)
        self._store.init_schema()

        self._embedder = GeminiEmbedder(
            api_key=api_key,
            model=embed_model,
            dimensions=dimensions,
        )

        self._media = MediaManager(
            store=self._store,
            media_dir=media_dir,
            inline_max_bytes=inline_max_bytes,
        )

        self._retriever = MemoryRetriever(
            store=self._store,
            embedder=self._embedder,
            max_candidates=max_candidates,
            max_injected=max_injected,
        )

        self._extractor = MemoryExtractor()

        # --- Config values stored for reference / dedup --------------------
        self._dedup_threshold = dedup_threshold
        self._dimensions = dimensions
        self._consolidation_similarity_threshold = (
            consolidation_similarity_threshold
            if consolidation_similarity_threshold is not None
            else dedup_threshold
        )
        self._consolidation_run_interval = max(0, consolidation_run_interval)
        self._fact_confirm_threshold = fact_confirm_threshold
        self._runs_since_consolidation: set[str] = set()
        self._writes_without_run_id_since_consolidation = 0

        # --- Classification validation cache/config -------------------------
        self._classification_reference_texts: dict[str, str] = {
            "episode": "A short summary of what happened during an action or run.",
            "fact": "A durable factual statement about the world or the agent.",
            "preference": "A stable preference, style, or taste the agent has.",
            "goal": "An objective, plan, or intention the agent wants to achieve.",
            "entity": "A person, place, organization, or topic profile reference.",
            "media": "A memory record describing image, audio, video, or PDF artifacts.",
        }
        self._classification_reference_embeddings_cache: dict[str, np.ndarray] | None = None
        self._classification_confidence_penalty = 0.8

    # ------------------------------------------------------------------
    # Read pipeline
    # ------------------------------------------------------------------

    async def retrieve_for_action(
        self,
        action_id: str,
        global_prompt: str | None = None,
        action_prompt: str | None = None,
    ) -> str:
        """Retrieve formatted memories relevant to an upcoming action.

        Delegates to the :class:`MemoryRetriever` pipeline which performs
        FTS5 candidate generation, embedding, cosine scoring, score
        blending, and prompt injection formatting.

        Returns an empty string if no relevant memories are found, the
        store is empty, or any error occurs.  Never raises.

        Parameters
        ----------
        action_id : str
            The ID of the action about to run.
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
            query_text = self._retriever.build_query(
                action_id,
                global_prompt,
                action_prompt,
            )
            return await self._retriever.retrieve(
                query_text,
                action_id=action_id,
                global_prompt=global_prompt,
                action_prompt=action_prompt,
            )
        except Exception:
            logger.error(
                "Memory retrieval failed for action '%s' — continuing without memory",
                action_id,
                exc_info=True,
            )
            return ""

    # ------------------------------------------------------------------
    # Write pipeline
    # ------------------------------------------------------------------

    async def write_from_action(
        self,
        action_id: str,
        result_text: str,
        run_id: str | None = None,
        media_paths: list[str] | None = None,
    ) -> list[str]:
        """Extract, embed, and store memories from an action's output.

        Pipeline:
        1. Extract typed memory candidates from the action result.
        2. For each candidate, attempt to embed with ``RETRIEVAL_DOCUMENT``.
        3. Store the memory (with or without embedding).

        Returns a list of stored memory IDs.  If the extractor fails, logs
        an error and returns an empty list.  If the embedder fails for a
        particular memory, the memory is stored without an embedding row.
        If the store fails, logs an error and returns an empty list.

        Parameters
        ----------
        action_id : str
            The ID of the completed action.
        result_text : str
            Raw text output from the action.
        run_id : str, optional
            Run identifier for provenance tracking.
        media_paths : list[str], optional
            File paths to media artifacts produced by the action.

        Returns
        -------
        list[str]
            IDs of successfully stored memories.
        """
        stored_ids: list[str] = []

        try:
            # 1. Extract memory candidates
            try:
                candidates = self._extractor.extract_from_action(
                    action_id=action_id,
                    result_text=result_text,
                    run_id=run_id,
                    media_paths=media_paths,
                )
            except Exception:
                logger.error(
                    "Memory extraction failed for action '%s' — skipping write",
                    action_id,
                    exc_info=True,
                )
                return []

            if not candidates:
                return []

            # 2. Store each candidate (with optional embedding)
            for candidate in candidates:
                candidate = await self._apply_classification_validation(candidate)

                duplicate_id, semantic_similarity_vector = await self._find_semantic_duplicate(
                    candidate
                )
                if duplicate_id is not None:
                    stored_ids.append(duplicate_id)
                    continue

                try:
                    memory = self._store.create_memory(
                        kind=candidate["kind"],
                        modality=candidate["modality"],
                        content=candidate.get("content", ""),
                        importance=candidate.get("importance", 0.5),
                        confidence=candidate.get("confidence", 0.5),
                        fingerprint=candidate["fingerprint"],
                        summary=candidate.get("summary"),
                        source_run_id=candidate.get("source_run_id"),
                        source_action_id=candidate.get("source_action_id"),
                    )
                except Exception:
                    logger.error(
                        "Failed to store memory (fingerprint=%s) — skipping",
                        candidate.get("fingerprint", "?"),
                        exc_info=True,
                    )
                    continue

                memory_id = memory["id"]
                stored_ids.append(memory_id)

                # 3. Attempt to embed the memory content
                await self._try_embed_and_store(
                    memory_id,
                    candidate,
                    semantic_similarity_vector=semantic_similarity_vector,
                )

            return stored_ids
        finally:
            await self._maybe_auto_trigger_consolidation(run_id)

    # ------------------------------------------------------------------
    # Consolidation and fact verification
    # ------------------------------------------------------------------

    async def trigger_consolidation(self) -> list[str]:
        """Consolidate similar active memories using CLUSTERING embeddings.

        Returns a list of newly created consolidated memory IDs.
        """
        try:
            active_memories = self._store.get_memories(include_inactive=False)
        except Exception:
            logger.error("Failed to load active memories for consolidation", exc_info=True)
            return []

        if len(active_memories) < 2:
            return []

        embedding_rows: list[dict] = []
        for memory in active_memories:
            content = (memory.get("summary") or memory.get("content") or "").strip()
            if not content:
                continue

            vector = await self._embed_text_for_task(content, EmbedTaskType.CLUSTERING)
            if vector is None:
                continue

            embedding_rows.append(
                {
                    "memory": memory,
                    "vector": vector,
                }
            )

        if len(embedding_rows) < 2:
            return []

        labels = self._cluster_vectors(
            [row["vector"] for row in embedding_rows],
            similarity_threshold=self._consolidation_similarity_threshold,
        )

        clusters: dict[int, list[dict]] = {}
        for row, label in zip(embedding_rows, labels, strict=False):
            clusters.setdefault(label, []).append(row)

        consolidated_ids: list[str] = []
        for members in clusters.values():
            if len(members) < 2:
                continue

            for subgroup in self._connected_similarity_groups(
                members,
                similarity_threshold=self._consolidation_similarity_threshold,
            ):
                if len(subgroup) < 2:
                    continue

                consolidated_id = await self._merge_cluster_group(subgroup)
                if consolidated_id is not None:
                    consolidated_ids.append(consolidated_id)

        return consolidated_ids

    async def verify_fact(self, claim: str) -> dict:
        """Verify a claim against stored fact memories using vector similarity.

        Returns a dict with:
          - status: confirmed | unverified | insufficient-data
          - similarity: float | None
          - matched_memory_id: str | None
          - matched_content: str | None
        """
        try:
            fact_rows = [
                row
                for row in self._store.get_active_embeddings(
                    task_type=EmbedTaskType.RETRIEVAL_DOCUMENT.value,
                )
                if row.get("kind") == "fact"
            ]
        except Exception:
            logger.error("Failed to load fact embeddings for verification", exc_info=True)
            return {
                "status": "insufficient-data",
                "similarity": None,
                "matched_memory_id": None,
                "matched_content": None,
            }

        if not fact_rows:
            return {
                "status": "insufficient-data",
                "similarity": None,
                "matched_memory_id": None,
                "matched_content": None,
            }

        claim_vector = await self._embed_text_for_task(claim, EmbedTaskType.FACT_VERIFICATION)
        if claim_vector is None:
            return {
                "status": "unverified",
                "similarity": None,
                "matched_memory_id": None,
                "matched_content": None,
            }

        best_match: dict | None = None
        best_score = -1.0
        for row in fact_rows:
            row_vector = np.array(row.get("vector", []), dtype=np.float32)
            if row_vector.size == 0:
                continue
            score = self._cosine_similarity(claim_vector, row_vector)
            if score > best_score:
                best_score = score
                best_match = row

        if best_match is None:
            return {
                "status": "insufficient-data",
                "similarity": None,
                "matched_memory_id": None,
                "matched_content": None,
            }

        status = "confirmed" if best_score >= self._fact_confirm_threshold else "unverified"
        return {
            "status": status,
            "similarity": float(best_score),
            "matched_memory_id": best_match.get("id"),
            "matched_content": best_match.get("content"),
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _maybe_auto_trigger_consolidation(self, run_id: str | None) -> None:
        """Trigger consolidation automatically after the configured run interval."""
        if self._consolidation_run_interval <= 0:
            return

        if run_id:
            self._runs_since_consolidation.add(run_id)
        else:
            self._writes_without_run_id_since_consolidation += 1

        progress_count = (
            len(self._runs_since_consolidation) + self._writes_without_run_id_since_consolidation
        )
        if progress_count < self._consolidation_run_interval:
            return

        try:
            await self.trigger_consolidation()
        except Exception:
            logger.error("Auto-triggered consolidation failed", exc_info=True)
        finally:
            self._runs_since_consolidation.clear()
            self._writes_without_run_id_since_consolidation = 0

    def _cluster_vectors(
        self,
        vectors: list[np.ndarray],
        *,
        similarity_threshold: float,
    ) -> list[int]:
        """Cluster vectors with agglomerative clustering over cosine distance."""
        if len(vectors) < 2:
            return [0 for _ in vectors]

        distance_threshold = max(0.0, 1.0 - similarity_threshold)
        matrix = np.vstack(vectors)

        try:
            try:
                model = AgglomerativeClustering(
                    n_clusters=None,
                    metric="cosine",
                    linkage="average",
                    distance_threshold=distance_threshold,
                )
            except TypeError:
                model = AgglomerativeClustering(
                    n_clusters=None,
                    affinity="cosine",
                    linkage="average",
                    distance_threshold=distance_threshold,
                )

            labels = model.fit_predict(matrix)
            return [int(x) for x in labels.tolist()]
        except Exception:
            logger.error("Consolidation clustering failed", exc_info=True)
            return list(range(len(vectors)))

    def _connected_similarity_groups(
        self,
        rows: list[dict],
        *,
        similarity_threshold: float,
    ) -> list[list[dict]]:
        """Split cluster members into connected groups by pairwise similarity threshold."""
        if len(rows) <= 1:
            return [rows]

        adjacency: dict[int, set[int]] = {idx: set() for idx in range(len(rows))}
        for idx in range(len(rows)):
            for jdx in range(idx + 1, len(rows)):
                sim = self._cosine_similarity(rows[idx]["vector"], rows[jdx]["vector"])
                if sim >= similarity_threshold:
                    adjacency[idx].add(jdx)
                    adjacency[jdx].add(idx)

        visited: set[int] = set()
        groups: list[list[dict]] = []

        for start in range(len(rows)):
            if start in visited:
                continue

            stack = [start]
            component: list[dict] = []
            visited.add(start)

            while stack:
                current = stack.pop()
                component.append(rows[current])
                for neighbor in adjacency[current]:
                    if neighbor in visited:
                        continue
                    visited.add(neighbor)
                    stack.append(neighbor)

            groups.append(component)

        return groups

    async def _merge_cluster_group(self, rows: list[dict]) -> str | None:
        """Merge a similar-memory group into one consolidated memory."""
        source_memories = [row["memory"] for row in rows]
        source_ids = [memory["id"] for memory in source_memories]

        anchor = max(source_memories, key=lambda m: float(m.get("importance", 0.0)))
        merged_importance = max(float(memory.get("importance", 0.0)) for memory in source_memories)
        merged_confidence = max(float(memory.get("confidence", 0.0)) for memory in source_memories)
        merged_kind = anchor.get("kind", "fact")

        contents: list[str] = []
        for memory in source_memories:
            text = (memory.get("summary") or memory.get("content") or "").strip()
            if text and text not in contents:
                contents.append(text)

        if not contents:
            return None

        merged_content = " | ".join(contents)
        merged_summary = contents[0]
        normalized = self._extractor.normalize_content(merged_content)
        fingerprint_source = f"consolidated:{'|'.join(sorted(source_ids))}:{normalized}"
        merged_fingerprint = self._extractor.generate_fingerprint(fingerprint_source)

        try:
            consolidated_memory = self._store.create_memory(
                kind=merged_kind,
                modality="text",
                content=merged_content,
                importance=merged_importance,
                confidence=merged_confidence,
                fingerprint=merged_fingerprint,
                summary=merged_summary,
                source_run_id=anchor.get("source_run_id"),
                source_action_id="consolidation",
            )
        except Exception:
            logger.error("Failed to create consolidated memory", exc_info=True)
            return None

        consolidated_id = consolidated_memory["id"]
        await self._try_embed_and_store(
            consolidated_id,
            {
                "content": merged_content,
            },
        )

        cluster_vector = await self._embed_text_for_task(
            merged_content,
            EmbedTaskType.CLUSTERING,
        )
        if cluster_vector is not None:
            self._store_embedding(
                memory_id=consolidated_id,
                vector=cluster_vector,
                task_type=EmbedTaskType.CLUSTERING,
            )

        for source_id in source_ids:
            try:
                self._store.deactivate_memory(source_id)
            except Exception:
                logger.error(
                    "Failed to deactivate source memory %s after consolidation",
                    source_id,
                    exc_info=True,
                )

        return str(consolidated_id) if consolidated_id is not None else None

    async def _try_embed_and_store(
        self,
        memory_id: str,
        candidate: dict,
        *,
        semantic_similarity_vector: np.ndarray | None = None,
    ) -> None:
        """Attempt to embed memory content and store the vector.

        If embedding fails (API error or None return), the memory is
        kept without an embedding — graceful degradation.
        """
        content = candidate.get("content", "")
        retrieval_vector: np.ndarray | None = None
        if content:
            retrieval_vector = await self._embed_text_for_task(
                content,
                EmbedTaskType.RETRIEVAL_DOCUMENT,
            )

        if retrieval_vector is not None:
            self._store_embedding(
                memory_id=memory_id,
                vector=retrieval_vector,
                task_type=EmbedTaskType.RETRIEVAL_DOCUMENT,
            )

        if semantic_similarity_vector is not None:
            self._store_embedding(
                memory_id=memory_id,
                vector=semantic_similarity_vector,
                task_type=EmbedTaskType.SEMANTIC_SIMILARITY,
            )

    async def _find_semantic_duplicate(
        self,
        candidate: dict,
    ) -> tuple[str | None, np.ndarray | None]:
        """Return an existing memory ID when semantic dedup threshold is met.

        Also returns the candidate's SEMANTIC_SIMILARITY embedding so callers
        can reuse it for storage when no duplicate is found.
        """
        content = candidate.get("content", "")
        if not content:
            return None, None

        similarity_vector = await self._embed_text_for_task(
            content,
            EmbedTaskType.SEMANTIC_SIMILARITY,
        )
        if similarity_vector is None:
            return None, None

        try:
            existing = self._store.get_active_embeddings(
                task_type=EmbedTaskType.SEMANTIC_SIMILARITY.value,
            )
        except Exception:
            logger.error("Failed to load active semantic embeddings for dedup", exc_info=True)
            return None, similarity_vector

        best_match_id: str | None = None
        best_similarity = -1.0
        for row in existing:
            vector = np.array(row.get("vector", []), dtype=np.float32)
            if vector.size == 0:
                continue
            score = self._cosine_similarity(similarity_vector, vector)
            if score > best_similarity:
                best_similarity = score
                best_match_id = row["id"]

        if best_match_id is None or best_similarity < self._dedup_threshold:
            return None, similarity_vector

        reinforced = self._store.reinforce_memory(best_match_id, increment_by=1)
        if reinforced is None:
            return None, similarity_vector

        return reinforced["id"], similarity_vector

    async def _apply_classification_validation(self, candidate: dict) -> dict:
        """Validate extractor-assigned kind using CLASSIFICATION embeddings.

        If classifier prediction disagrees with extractor kind, the candidate
        confidence is reduced (kind is preserved).
        """
        content = candidate.get("content", "")
        if not content:
            return candidate

        predicted_kind = await self._predict_memory_kind(content)
        if predicted_kind is None:
            return candidate

        current_kind = candidate.get("kind")
        if current_kind == predicted_kind:
            return candidate

        updated = dict(candidate)
        base_confidence = float(updated.get("confidence", 0.5))
        updated["confidence"] = max(
            0.0,
            min(1.0, base_confidence * self._classification_confidence_penalty),
        )
        return updated

    async def _predict_memory_kind(self, content: str) -> str | None:
        """Predict the closest memory kind for text using CLASSIFICATION vectors."""
        candidate_vector = await self._embed_text_for_task(
            content,
            EmbedTaskType.CLASSIFICATION,
        )
        if candidate_vector is None:
            return None

        references = await self._get_classification_reference_embeddings()
        if not references:
            return None

        best_kind: str | None = None
        best_score = -1.0
        for kind, ref_vector in references.items():
            score = self._cosine_similarity(candidate_vector, ref_vector)
            if score > best_score:
                best_score = score
                best_kind = kind

        return best_kind

    async def _get_classification_reference_embeddings(self) -> dict[str, np.ndarray]:
        """Load or lazily compute CLASSIFICATION reference embeddings."""
        if self._classification_reference_embeddings_cache is not None:
            return self._classification_reference_embeddings_cache

        computed: dict[str, np.ndarray] = {}
        for kind, reference_text in self._classification_reference_texts.items():
            vector = await self._embed_text_for_task(
                reference_text,
                EmbedTaskType.CLASSIFICATION,
            )
            if vector is None:
                continue
            computed[kind] = vector

        if computed:
            self._classification_reference_embeddings_cache = computed
        return computed

    async def _embed_text_for_task(
        self,
        text: str,
        task_type: EmbedTaskType,
    ) -> np.ndarray | None:
        """Embed text for a specific task type with graceful failure."""
        try:
            vector = await self._embedder.embed_text(text, task_type=task_type)
        except Exception:
            logger.error(
                "Embedding failed for task %s",
                task_type.value,
                exc_info=True,
            )
            return None

        if vector is None:
            logger.warning("Embedder returned None for task %s", task_type.value)
            return None

        return vector

    def _store_embedding(
        self,
        *,
        memory_id: str,
        vector: np.ndarray,
        task_type: EmbedTaskType,
    ) -> None:
        """Store one embedding row, swallowing failures."""
        try:
            norm = float(np.linalg.norm(vector))
            self._store.store_embedding(
                memory_id=memory_id,
                model=self._embedder.model,
                task_type=task_type.value,
                dimensions=self._dimensions,
                vector=vector.tolist(),
                vector_norm=norm,
            )
        except Exception:
            logger.error(
                "Failed to store %s embedding for memory %s",
                task_type.value,
                memory_id,
                exc_info=True,
            )

    @staticmethod
    def _cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
        """Compute cosine similarity for two vectors."""
        norm_a = float(np.linalg.norm(vec_a))
        norm_b = float(np.linalg.norm(vec_b))
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))
