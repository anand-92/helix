"""Gemini Embedding 2 REST client for Helix's memory subsystem.

Calls the Gemini REST API via httpx for embedding text and media content.
Supports all 8 task types and all modalities (text, image, audio, video, PDF).
Returns L2-normalized 768-dim numpy arrays.  Gracefully handles API errors
by returning ``None`` and logging the error (never exposing the API key).
"""

import base64
from enum import Enum

import httpx
import numpy as np
import structlog

logger = structlog.get_logger(__name__)

_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
_DEFAULT_MODEL = "gemini-embedding-2-preview"
_DEFAULT_DIM = 768


# ---------------------------------------------------------------------------
# Task types
# ---------------------------------------------------------------------------


class EmbedTaskType(str, Enum):
    """All task types supported by Gemini Embedding 2."""

    RETRIEVAL_DOCUMENT = "RETRIEVAL_DOCUMENT"
    RETRIEVAL_QUERY = "RETRIEVAL_QUERY"
    SEMANTIC_SIMILARITY = "SEMANTIC_SIMILARITY"
    CLASSIFICATION = "CLASSIFICATION"
    CLUSTERING = "CLUSTERING"
    FACT_VERIFICATION = "FACT_VERIFICATION"
    QUESTION_ANSWERING = "QUESTION_ANSWERING"
    CODE_RETRIEVAL_QUERY = "CODE_RETRIEVAL_QUERY"


# ---------------------------------------------------------------------------
# Embedder
# ---------------------------------------------------------------------------


class GeminiEmbedder:
    """REST client for the Gemini Embedding 2 API.

    Parameters
    ----------
    api_key : str
        Gemini API key (sent via ``x-goog-api-key`` header).
    model : str
        Embedding model identifier.
    dimensions : int
        Output dimensionality (always set via ``output_dimensionality``).
    """

    def __init__(
        self,
        api_key: str,
        model: str = _DEFAULT_MODEL,
        dimensions: int = _DEFAULT_DIM,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._dimensions = dimensions
        self._client = httpx.AsyncClient(timeout=60.0)

        # Pre-compute endpoint URLs
        self._embed_url = f"{_GEMINI_BASE_URL}/models/{self._model}:embedContent"
        self._batch_url = f"{_GEMINI_BASE_URL}/models/{self._model}:batchEmbedContents"

    @property
    def model(self) -> str:
        """The embedding model identifier."""
        return self._model

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> "GeminiEmbedder":
        return self

    async def __aexit__(self, exc_type: object, exc_val: object, exc_tb: object) -> None:
        await self.aclose()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _auth_headers(self) -> dict[str, str]:
        """Return authentication headers (never logged)."""
        return {"x-goog-api-key": self._api_key}

    @staticmethod
    def _l2_normalize(vec: np.ndarray) -> np.ndarray:
        """L2-normalize a vector in-place.  Returns the normalized vector."""
        norm = float(np.linalg.norm(vec))
        if norm == 0.0:
            return vec
        return vec / norm

    def _build_text_part(self, text: str) -> dict:
        """Build a ``content.parts`` entry for plain text."""
        return {"text": text}

    @staticmethod
    def _build_media_part(data: bytes, mime_type: str) -> dict:
        """Build a ``content.parts`` entry for binary media."""
        return {
            "inline_data": {
                "mime_type": mime_type,
                "data": base64.b64encode(data).decode(),
            }
        }

    def _build_request_body(
        self,
        parts: list[dict],
        task_type: EmbedTaskType,
    ) -> dict:
        """Build the JSON body for the ``embedContent`` endpoint."""
        return {
            "content": {"parts": parts},
            "taskType": task_type.value,
            "output_dimensionality": self._dimensions,
        }

    def _build_batch_item(
        self,
        parts: list[dict],
        task_type: EmbedTaskType,
    ) -> dict:
        """Build a single item for the ``batchEmbedContents.requests`` array."""
        return {
            "model": f"models/{self._model}",
            "content": {"parts": parts},
            "taskType": task_type.value,
            "output_dimensionality": self._dimensions,
        }

    def _parse_single_embedding(self, resp_json: dict) -> np.ndarray | None:
        """Extract and L2-normalize the embedding vector from an embedContent response."""
        values = resp_json.get("embedding", {}).get("values")
        if values is None:
            return None
        vec = np.array(values, dtype=np.float32)
        return self._l2_normalize(vec)

    def _parse_batch_embeddings(self, resp_json: dict) -> list[np.ndarray] | None:
        """Extract and L2-normalize all vectors from a batchEmbedContents response."""
        embeddings = resp_json.get("embeddings")
        if embeddings is None:
            return None
        results: list[np.ndarray] = []
        for emb in embeddings:
            values = emb.get("values")
            if values is None:
                return None
            vec = np.array(values, dtype=np.float32)
            results.append(self._l2_normalize(vec))
        return results

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def embed_text(
        self,
        text: str,
        task_type: EmbedTaskType = EmbedTaskType.RETRIEVAL_DOCUMENT,
    ) -> np.ndarray | None:
        """Embed a text string.

        Returns a 768-dim L2-normalized numpy array, or ``None`` on error.
        """
        parts = [self._build_text_part(text)]
        body = self._build_request_body(parts, task_type)
        return await self._post_embed(body)

    async def embed_media(
        self,
        data: bytes,
        mime_type: str,
        task_type: EmbedTaskType = EmbedTaskType.RETRIEVAL_DOCUMENT,
    ) -> np.ndarray | None:
        """Embed binary media (image, audio, video, PDF).

        Returns a 768-dim L2-normalized numpy array, or ``None`` on error.
        """
        parts = [self._build_media_part(data, mime_type)]
        body = self._build_request_body(parts, task_type)
        return await self._post_embed(body)

    async def embed_multimodal(
        self,
        parts_spec: list[dict],
        task_type: EmbedTaskType = EmbedTaskType.RETRIEVAL_DOCUMENT,
    ) -> np.ndarray | None:
        """Embed a multimodal content entry with mixed parts.

        ``parts_spec`` is a list of dicts, each with either:
        - ``{"text": "..."}`` for a text part
        - ``{"data": bytes, "mime_type": "..."}`` for a media part

        Returns a single 768-dim L2-normalized numpy array (aggregated
        embedding from all parts), or ``None`` on error.
        """
        parts = self._convert_parts_spec(parts_spec)
        body = self._build_request_body(parts, task_type)
        return await self._post_embed(body)

    async def embed_batch(
        self,
        items: list[dict],
        task_type: EmbedTaskType = EmbedTaskType.RETRIEVAL_DOCUMENT,
    ) -> list[np.ndarray] | None:
        """Embed multiple items in a single batch request.

        ``items`` is a list of dicts, each with either:
        - ``{"text": "..."}`` for a text item
        - ``{"data": bytes, "mime_type": "..."}`` for a media item

        Returns a list of 768-dim L2-normalized numpy arrays (one per item,
        order preserved), or ``None`` on error.
        """
        if not items:
            return []

        requests = []
        for item in items:
            parts = self._convert_parts_spec([item])
            requests.append(self._build_batch_item(parts, task_type))

        body = {"requests": requests}

        try:
            resp = await self._client.post(
                self._batch_url,
                json=body,
                headers=self._auth_headers(),
            )
            if not resp.is_success:
                logger.error(
                    "Gemini batch embed API returned %d — embedding failed",
                    resp.status_code,
                )
                return None
            return self._parse_batch_embeddings(resp.json())
        except Exception:
            logger.error("Gemini batch embed request failed", exc_info=True)
            return None

    def average_embeddings(
        self,
        vectors: list[np.ndarray],
    ) -> np.ndarray | None:
        """Average multiple embedding vectors and L2-normalize the result.

        Use this when a memory has multiple separate media items that each
        produce their own embedding and you need a single memory-level vector.

        Returns ``None`` for an empty list.
        """
        if not vectors:
            return None
        mean_vec = np.mean(vectors, axis=0)
        return self._l2_normalize(mean_vec)

    # ------------------------------------------------------------------
    # Private POST helper
    # ------------------------------------------------------------------

    async def _post_embed(self, body: dict) -> np.ndarray | None:
        """POST to the single-embed endpoint and return the L2-normalized vector."""
        try:
            resp = await self._client.post(
                self._embed_url,
                json=body,
                headers=self._auth_headers(),
            )
            if not resp.is_success:
                logger.error(
                    "Gemini embed API returned %d — embedding failed",
                    resp.status_code,
                )
                return None
            return self._parse_single_embedding(resp.json())
        except Exception:
            logger.error("Gemini embed request failed", exc_info=True)
            return None

    @staticmethod
    def _convert_parts_spec(parts_spec: list[dict]) -> list[dict]:
        """Convert user-friendly part dicts to Gemini API ``content.parts`` format."""
        parts: list[dict] = []
        for spec in parts_spec:
            if "text" in spec:
                parts.append({"text": spec["text"]})
            elif "data" in spec and "mime_type" in spec:
                parts.append(
                    {
                        "inline_data": {
                            "mime_type": spec["mime_type"],
                            "data": base64.b64encode(spec["data"]).decode(),
                        }
                    }
                )
            else:
                logger.warning(
                    "Skipping unrecognized parts_spec entry with keys: %s",
                    sorted(spec.keys()),
                )
        return parts
