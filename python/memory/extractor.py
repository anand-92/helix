"""Converts action output into typed memory candidates.

Uses pattern matching and heuristics (no LLM calls) to extract
episode summaries, facts, preferences, goals, entities, and media
memories from action results.  All extraction is deterministic and fast.
"""

import hashlib
import re
import uuid
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# File extension → modality mapping
# ---------------------------------------------------------------------------

_EXT_TO_MODALITY: dict[str, str] = {
    ".wav": "audio",
    ".mp3": "audio",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".mp4": "video",
    ".mov": "video",
    ".pdf": "pdf",
}

# ---------------------------------------------------------------------------
# Pattern-based extraction rules
# ---------------------------------------------------------------------------

# Fact patterns — declarative "X is Y" or "X has Y" style sentences
_FACT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"(?:^|\. |\n)"  # sentence boundary
        r"("
        r"[A-Z][^.!?\n]{5,120}"  # starts with uppercase, 6-121 chars
        r"(?:\bis\b|\bare\b|\bwas\b|\bwere\b|\bhas\b|\bhave\b|\bhad\b)"
        r"[^.!?\n]{3,}"  # rest of the sentence
        r")"
        r"[.!]",
        re.MULTILINE,
    ),
    # "The temperature today is 72 degrees." / "He lives in California."
    re.compile(
        r"(?:^|\. |\n)"
        r"("
        r"(?:The|This|That|It|He|She|They)\s"
        r"[^.!?\n]{5,120}"
        r")"
        r"[.!]",
        re.MULTILINE,
    ),
]

# Preference patterns — "prefers X", "likes X", "favorite", etc.
_PREFERENCE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"("
        r"[^.!?\n]*"
        r"(?:\bprefers?\b|\blikes?\b|\bfavorite\b|\bfavourite\b"
        r"|\brather\b|\binstead of\b|\bover\b.*?\bover\b"
        r"|\bdark mode\b|\blight mode\b)"
        r"[^.!?\n]*"
        r")",
        re.IGNORECASE,
    ),
]

# Goal patterns — "wants to", "goal is", "aim to", "plan to", etc.
_GOAL_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"("
        r"[^.!?\n]*"
        r"(?:\bwants? to\b|\bgoal\b|\baim(?:s|ing)? to\b"
        r"|\bplan(?:s|ning)? to\b|\bobjective\b|\bintend(?:s|ing)?\b"
        r"|\bbecome\b|\bachieve\b|\bwithout (?:human |any )?intervention\b)"
        r"[^.!?\n]*"
        r")",
        re.IGNORECASE,
    ),
]

# Entity patterns — @mentions, capitalized multi-word names, org names
_ENTITY_PATTERNS: list[re.Pattern[str]] = [
    # @mentions (e.g., @elonmusk, @NBA)
    re.compile(r"@([A-Za-z_]\w{1,30})"),
    # Capitalized multi-word proper nouns (e.g., "NBA Finals", "Los Angeles Lakers")
    re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b"),
    # All-caps acronyms of 2-6 chars (e.g., "NBA", "NFL", "API")
    re.compile(r"\b([A-Z]{2,6})\b"),
]

# Words to exclude from entity extraction
_ENTITY_STOPWORDS: frozenset[str] = frozenset(
    {
        # Common English
        "THE",
        "AND",
        "FOR",
        "BUT",
        "NOT",
        "YOU",
        "ALL",
        "CAN",
        "HER",
        "WAS",
        "ONE",
        "OUR",
        "OUT",
        "HAS",
        "HIS",
        "HOW",
        "ITS",
        "MAY",
        "NEW",
        "NOW",
        "OLD",
        "SEE",
        "WAY",
        "WHO",
        "DID",
        "GET",
        "HIM",
        "LET",
        "SAY",
        "SHE",
        "TOO",
        "USE",
        "ARE",
        "HAD",
        "ANY",
        "BEEN",
        "WILL",
        "THAN",
        "THEN",
        "ALSO",
        "JUST",
        "SOME",
        "VERY",
        "ONLY",
        "THAT",
        "THIS",
        "WITH",
        "FROM",
        "THEY",
        "WHAT",
        "WHEN",
        "MAKE",
        "LIKE",
        "EACH",
        "MADE",
        "FIND",
        "HERE",
        "MANY",
        "WELL",
        "BACK",
        "MUCH",
        "WENT",
        "THEM",
        "HAVE",
        "WERE",
        "SAID",
        "DOES",
        # File extensions / formats
        "PNG",
        "WAV",
        "MP3",
        "MP4",
        "PDF",
        "JPG",
        "CSV",
        "JSON",
        "HTML",
        "CSS",
        "SVG",
        "GIF",
        "TXT",
        "YAML",
        "TOML",
        # Technical / code terms
        "API",
        "URL",
        "CLI",
        "SDK",
        "MCP",
        "SQL",
        "FTS",
        "UTC",
        "RAM",
        "CPU",
        "GPU",
        "SSH",
        "TLS",
        "DNS",
        "IP",
        "ID",
        "DB",
        "UI",
        "UX",
        "PR",
        "CI",
        "CD",
        "OS",
        "IO",
        "ENV",
        "CWD",
        "PID",
        "TTY",
        "PATH",
        "SKILL",
        "MEMORY",
        "ASCII",
        "EDIT",
        "READ",
        "BASH",
        "FILE",
        "TODO",
        "GLOB",
        "GREP",
        "TASK",
        "WRITE",
        # Markdown / report artifacts
        "NOTE",
        "REPORT",
        "CHANGES",
        "NEEDED",
        "NONE",
        "SUMMARY",
        "PASS",
        "SECTION",
        "ADDED",
        "FIXED",
        "UPDATED",
    }
)

# Minimum character length for entity content after normalization
_ENTITY_MIN_LENGTH = 3

# Maximum entities to extract per action (prevents flooding from verbose output)
_ENTITY_MAX_PER_ACTION = 5

# Regex to detect markdown formatting around a match
_MARKDOWN_CONTEXT_RE = re.compile(
    r"(?:^|\n)\s*#{1,6}\s+.*{entity}|"
    r"\*\*[^*]*{entity}[^*]*\*\*|"
    r"__[^_]*{entity}[^_]*__"
)


# ---------------------------------------------------------------------------
# MemoryExtractor
# ---------------------------------------------------------------------------


class MemoryExtractor:
    """Extracts typed memory candidates from action output.

    All extraction uses pattern matching and heuristics — no LLM calls.
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract_from_action(
        self,
        action_id: str,
        result_text: str,
        run_id: str | None = None,
        media_paths: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Extract memory candidates from an action result.

        Always produces at least one ``episode`` summary.  Additionally
        extracts ``fact``, ``preference``, ``goal``, and ``entity``
        candidates from the text.  For each path in *media_paths*,
        creates a ``media`` memory with the appropriate modality.

        Parameters
        ----------
        action_id:
            Identifier of the originating action (e.g. ``"hello"``).
        result_text:
            Raw text output from the action.
        run_id:
            Optional run identifier for provenance tracking.
        media_paths:
            Optional list of file-system paths to media artifacts
            produced by the action.

        Returns
        -------
        list of dict
            Each dict is a memory candidate ready for storage.
        """
        memories: list[dict[str, Any]] = []
        seen_fingerprints: set[str] = set()

        # 1. Episode summary — always produced
        episode = self._make_episode(action_id, result_text, run_id)
        memories.append(episode)
        seen_fingerprints.add(episode["fingerprint"])

        # 2. Typed extraction from text (deduplicate across extractor types).
        #    More-specific extractors run first so their kind wins over
        #    the broader fact extractor when the same text matches both.
        if result_text and result_text.strip():
            for candidate in (
                *self._extract_preferences(result_text, action_id, run_id),
                *self._extract_goals(result_text, action_id, run_id),
                *self._extract_entities(result_text, action_id, run_id),
                *self._extract_facts(result_text, action_id, run_id),
            ):
                if candidate["fingerprint"] not in seen_fingerprints:
                    seen_fingerprints.add(candidate["fingerprint"])
                    memories.append(candidate)

        # 3. Media memories
        if media_paths:
            for path_str in media_paths:
                mem = self._make_media_memory(path_str, action_id, run_id)
                if mem is not None and mem["fingerprint"] not in seen_fingerprints:
                    seen_fingerprints.add(mem["fingerprint"])
                    memories.append(mem)

        return memories

    def generate_fingerprint(self, content: str) -> str:
        """Generate a deterministic SHA-256 hex fingerprint for *content*.

        Same content always produces the same fingerprint.
        """
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def normalize_content(self, text: str) -> str:
        """Clean and normalize text for storage and fingerprinting.

        - Strips leading/trailing whitespace
        - Lowercases
        - Collapses internal whitespace (including newlines/tabs)
        - Collapses runs of repeated punctuation to a single instance
        """
        # Replace newlines and tabs with spaces
        text = re.sub(r"[\n\r\t]+", " ", text)
        # Collapse internal whitespace
        text = re.sub(r" {2,}", " ", text)
        # Strip and lowercase
        text = text.strip().lower()
        # Collapse repeated punctuation (e.g., "!!!" -> "!", "..." -> ".")
        text = re.sub(r"([!?.,:;])\1+", r"\1", text)
        return text

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _make_memory(
        self,
        kind: str,
        modality: str,
        content: str,
        action_id: str,
        run_id: str | None,
        *,
        importance: float = 0.5,
        confidence: float = 0.5,
    ) -> dict[str, Any]:
        """Build a memory candidate dict with all required fields."""
        normalized = self.normalize_content(content)
        return {
            "id": uuid.uuid4().hex,
            "kind": kind,
            "modality": modality,
            "content": normalized if normalized else content,
            "importance": importance,
            "confidence": confidence,
            "source_run_id": run_id,
            "source_action_id": action_id,
            "fingerprint": self.generate_fingerprint(normalized if normalized else content),
        }

    def _make_episode(
        self,
        action_id: str,
        result_text: str,
        run_id: str | None,
    ) -> dict[str, Any]:
        """Create an episode summary from action output."""
        # Build a compact summary — first 200 chars of the cleaned text
        cleaned = result_text.strip() if result_text else ""
        if cleaned:
            summary = cleaned[:200].rstrip()
            if len(cleaned) > 200:
                summary += "..."
        else:
            summary = f"action '{action_id}' completed with no text output"

        # Episode content = action label + summary
        episode_content = f"[{action_id}] {summary}"

        return self._make_memory(
            kind="episode",
            modality="text",
            content=episode_content,
            action_id=action_id,
            run_id=run_id,
            importance=0.5,
            confidence=0.9,
        )

    # ------------------------------------------------------------------
    # Text pattern extraction
    # ------------------------------------------------------------------

    def _extract_facts(
        self,
        text: str,
        action_id: str,
        run_id: str | None,
    ) -> list[dict[str, Any]]:
        """Extract factual statements using pattern matching."""
        seen: set[str] = set()
        results: list[dict[str, Any]] = []

        for pattern in _FACT_PATTERNS:
            for match in pattern.finditer(text):
                raw = match.group(1).strip()
                normalized = self.normalize_content(raw)
                fp = self.generate_fingerprint(normalized)
                if fp in seen or len(normalized) < 10:
                    continue
                seen.add(fp)
                results.append(
                    self._make_memory(
                        kind="fact",
                        modality="text",
                        content=raw,
                        action_id=action_id,
                        run_id=run_id,
                        importance=0.6,
                        confidence=0.7,
                    )
                )

        return results

    def _extract_preferences(
        self,
        text: str,
        action_id: str,
        run_id: str | None,
    ) -> list[dict[str, Any]]:
        """Extract preference statements using pattern matching."""
        seen: set[str] = set()
        results: list[dict[str, Any]] = []

        for pattern in _PREFERENCE_PATTERNS:
            for match in pattern.finditer(text):
                raw = match.group(1).strip()
                normalized = self.normalize_content(raw)
                fp = self.generate_fingerprint(normalized)
                if fp in seen or len(normalized) < 10:
                    continue
                seen.add(fp)
                results.append(
                    self._make_memory(
                        kind="preference",
                        modality="text",
                        content=raw,
                        action_id=action_id,
                        run_id=run_id,
                        importance=0.7,
                        confidence=0.6,
                    )
                )

        return results

    def _extract_goals(
        self,
        text: str,
        action_id: str,
        run_id: str | None,
    ) -> list[dict[str, Any]]:
        """Extract goal statements using pattern matching."""
        seen: set[str] = set()
        results: list[dict[str, Any]] = []

        for pattern in _GOAL_PATTERNS:
            for match in pattern.finditer(text):
                raw = match.group(1).strip()
                normalized = self.normalize_content(raw)
                fp = self.generate_fingerprint(normalized)
                if fp in seen or len(normalized) < 10:
                    continue
                seen.add(fp)
                results.append(
                    self._make_memory(
                        kind="goal",
                        modality="text",
                        content=raw,
                        action_id=action_id,
                        run_id=run_id,
                        importance=0.7,
                        confidence=0.6,
                    )
                )

        return results

    def _extract_entities(
        self,
        text: str,
        action_id: str,
        run_id: str | None,
    ) -> list[dict[str, Any]]:
        """Extract entity mentions (proper nouns, @handles, acronyms)."""
        seen: set[str] = set()
        results: list[dict[str, Any]] = []

        # Strip markdown formatting to avoid extracting header/bold text as entities
        cleaned = re.sub(r"^#{1,6}\s+.*$", "", text, flags=re.MULTILINE)
        cleaned = re.sub(r"\*\*[^*]*\*\*", "", cleaned)
        cleaned = re.sub(r"__[^_]*__", "", cleaned)
        cleaned = re.sub(r"`[^`]*`", "", cleaned)

        for pattern in _ENTITY_PATTERNS:
            for match in pattern.finditer(cleaned):
                raw = match.group(1).strip()
                if raw.upper() in _ENTITY_STOPWORDS:
                    continue
                # Check each word individually against stopwords
                words = raw.split()
                if all(w.upper() in _ENTITY_STOPWORDS for w in words):
                    continue
                normalized = self.normalize_content(raw)
                fp = self.generate_fingerprint(normalized)
                if fp in seen or len(normalized) < _ENTITY_MIN_LENGTH:
                    continue
                seen.add(fp)
                # @mentions get higher confidence
                confidence = 0.6 if raw.startswith("@") else 0.4
                results.append(
                    self._make_memory(
                        kind="entity",
                        modality="text",
                        content=raw,
                        action_id=action_id,
                        run_id=run_id,
                        importance=0.3,
                        confidence=confidence,
                    )
                )
                if len(results) >= _ENTITY_MAX_PER_ACTION:
                    return results

        return results

    # ------------------------------------------------------------------
    # Media memory creation
    # ------------------------------------------------------------------

    def _make_media_memory(
        self,
        path_str: str,
        action_id: str,
        run_id: str | None,
    ) -> dict[str, Any] | None:
        """Create a media memory from a file path.

        Determines modality from file extension.  Returns None for
        unrecognised extensions.
        """
        path = Path(path_str)
        ext = path.suffix.lower()
        modality = _EXT_TO_MODALITY.get(ext)

        if modality is None:
            logger.warning("Unknown media extension %r — skipping %s", ext, path_str)
            return None

        content = f"media:{modality}:{path.name}"
        return self._make_memory(
            kind="media",
            modality=modality,
            content=content,
            action_id=action_id,
            run_id=run_id,
            importance=0.5,
            confidence=0.8,
        )
