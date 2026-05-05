"""SQLite-backed memory store with FTS5 indexing and embedding support.

Provides CRUD operations for memories, embeddings, and media records.
All operations use parameterized queries. The store uses WAL mode for
concurrent read performance and FTS5 for fast lexical recall.
"""

import sqlite3
import struct
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class MemoryStore:
    """Persistent memory store backed by SQLite with WAL mode and FTS5.

    Parameters
    ----------
    db_path : Path | str
        Filesystem path for the SQLite database file.  Parent directories
        are created automatically.
    """

    def __init__(self, db_path: Path | str) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None

    # ------------------------------------------------------------------
    # Connection helpers
    # ------------------------------------------------------------------

    def _get_conn(self) -> sqlite3.Connection:
        """Return (and lazily create) the database connection."""
        if self._conn is None:
            self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA foreign_keys = ON")
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def __enter__(self) -> "MemoryStore":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @staticmethod
    def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
        """Convert a sqlite3.Row to a plain dict, or None."""
        if row is None:
            return None
        return dict(row)

    @staticmethod
    def _now_iso() -> str:
        """Return the current UTC time as an ISO-8601 string."""
        return datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    def init_schema(self) -> None:
        """Create all required tables and enable WAL mode.

        Safe to call multiple times (uses IF NOT EXISTS).
        """
        conn = self._get_conn()

        conn.execute("PRAGMA journal_mode = WAL")

        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS memories (
                id              TEXT PRIMARY KEY,
                kind            TEXT NOT NULL,
                modality        TEXT NOT NULL,
                content         TEXT,
                summary         TEXT,
                source_run_id   TEXT,
                source_action_id TEXT,
                importance      REAL NOT NULL DEFAULT 0.5,
                confidence      REAL NOT NULL DEFAULT 0.5,
                access_count    INTEGER NOT NULL DEFAULT 0,
                last_accessed_at TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                fingerprint     TEXT UNIQUE NOT NULL,
                is_active       INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS memory_embeddings (
                memory_id   TEXT NOT NULL,
                model       TEXT NOT NULL,
                task_type   TEXT NOT NULL,
                dimensions  INTEGER NOT NULL,
                vector_blob BLOB NOT NULL,
                vector_norm REAL NOT NULL,
                created_at  TEXT NOT NULL,
                PRIMARY KEY (memory_id, task_type),
                FOREIGN KEY (memory_id) REFERENCES memories(id)
            );

            CREATE TABLE IF NOT EXISTS memory_media (
                id              TEXT PRIMARY KEY,
                memory_id       TEXT NOT NULL,
                mime_type       TEXT NOT NULL,
                file_path       TEXT,
                data_blob       BLOB,
                file_size_bytes INTEGER,
                duration_seconds REAL,
                description     TEXT,
                created_at      TEXT NOT NULL,
                FOREIGN KEY (memory_id) REFERENCES memories(id)
            );
            """
        )

        # FTS5 virtual table — must use a regular execute (not executescript)
        # because FTS5 IF NOT EXISTS can be finicky inside executescript.
        # We check manually to avoid errors on repeated calls.
        existing = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                CREATE VIRTUAL TABLE memories_fts USING fts5(
                    memory_id,
                    content,
                    summary,
                    media_description
                )
                """
            )

        conn.commit()

    # ------------------------------------------------------------------
    # Memory CRUD
    # ------------------------------------------------------------------

    def create_memory(
        self,
        *,
        kind: str,
        modality: str,
        content: str,
        importance: float = 0.5,
        confidence: float = 0.5,
        fingerprint: str,
        summary: str | None = None,
        source_run_id: str | None = None,
        source_action_id: str | None = None,
    ) -> dict[str, Any]:
        """Insert a new memory row and index it in FTS5.

        Returns the created memory as a dict.
        Raises ``sqlite3.IntegrityError`` on duplicate fingerprint.
        """
        conn = self._get_conn()
        memory_id = uuid.uuid4().hex
        now = self._now_iso()

        conn.execute(
            """
            INSERT INTO memories
                (id, kind, modality, content, summary, source_run_id,
                 source_action_id, importance, confidence, access_count,
                 last_accessed_at, created_at, updated_at, fingerprint, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, 1)
            """,
            (
                memory_id,
                kind,
                modality,
                content,
                summary,
                source_run_id,
                source_action_id,
                importance,
                confidence,
                now,
                now,
                fingerprint,
            ),
        )

        # Index in FTS5 (media_description left empty; updated via create_media)
        conn.execute(
            """
            INSERT INTO memories_fts (memory_id, content, summary, media_description)
            VALUES (?, ?, ?, '')
            """,
            (
                memory_id,
                content if content is not None else "",
                summary if summary is not None else "",
            ),
        )

        conn.commit()
        result = self._row_to_dict(
            conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        )
        assert result is not None, f"Memory {memory_id} not found after INSERT"
        return result

    def get_memory(self, memory_id: str) -> dict[str, Any] | None:
        """Retrieve a single memory by ID (including inactive)."""
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        return self._row_to_dict(row)

    def get_memories(
        self,
        *,
        kind: str | None = None,
        limit: int | None = None,
        offset: int = 0,
        is_active: bool | None = None,
        include_inactive: bool = False,
    ) -> list[dict[str, Any]]:
        """Return memories with optional kind/active filters and pagination.

        Backward compatibility:
        - ``include_inactive=False`` keeps the previous default behavior
          of returning only active rows when ``is_active`` is not provided.
        """
        conn = self._get_conn()
        clauses: list[str] = []
        params: list[Any] = []

        if is_active is None:
            if not include_inactive:
                clauses.append("is_active = 1")
        else:
            clauses.append("is_active = 1")
            if not is_active:
                clauses[-1] = "is_active = 0"
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT * FROM memories {where} ORDER BY created_at DESC"
        normalized_limit: int | None = None
        if limit is not None:
            normalized_limit = max(0, int(limit))
            sql += " LIMIT ?"
            params.append(normalized_limit)
        if offset:
            if normalized_limit is None:
                # SQLite requires LIMIT when OFFSET is present.
                sql += " LIMIT -1"
            sql += " OFFSET ?"
            params.append(max(0, int(offset)))

        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def get_memory_stats(self) -> dict[str, Any]:
        """Return total memory count and grouped counts by kind."""
        conn = self._get_conn()
        total_row = conn.execute("SELECT COUNT(*) AS total_count FROM memories").fetchone()
        by_kind_rows = conn.execute(
            """
            SELECT kind, COUNT(*) AS count
            FROM memories
            GROUP BY kind
            ORDER BY kind
            """
        ).fetchall()

        return {
            "total_count": int(total_row["total_count"] if total_row is not None else 0),
            "by_kind": {row["kind"]: int(row["count"]) for row in by_kind_rows},
        }

    def update_memory(self, memory_id: str, **fields: Any) -> dict[str, Any] | None:
        """Update one or more fields on an existing memory.

        Returns the updated memory dict, or None if the memory does not exist.
        Allowed fields: content, summary, importance, confidence, kind,
        modality, source_run_id, source_action_id, access_count,
        last_accessed_at, is_active.
        """
        allowed = {
            "content",
            "summary",
            "importance",
            "confidence",
            "kind",
            "modality",
            "source_run_id",
            "source_action_id",
            "access_count",
            "last_accessed_at",
            "is_active",
        }
        update_fields = {k: v for k, v in fields.items() if k in allowed}
        if not update_fields:
            return self.get_memory(memory_id)

        conn = self._get_conn()

        # Check existence first
        existing = conn.execute("SELECT id FROM memories WHERE id = ?", (memory_id,)).fetchone()
        if existing is None:
            return None

        now = self._now_iso()
        update_fields["updated_at"] = now

        set_clause = ", ".join(f"{k} = ?" for k in update_fields)
        values = list(update_fields.values()) + [memory_id]

        conn.execute(f"UPDATE memories SET {set_clause} WHERE id = ?", values)

        # If content or summary changed, rebuild FTS entry
        if "content" in update_fields or "summary" in update_fields:
            self._rebuild_fts_entry(conn, memory_id)

        conn.commit()
        return self.get_memory(memory_id)

    def deactivate_memory(self, memory_id: str) -> None:
        """Soft-delete a memory by setting is_active = 0."""
        conn = self._get_conn()
        now = self._now_iso()
        conn.execute(
            "UPDATE memories SET is_active = 0, updated_at = ? WHERE id = ?",
            (now, memory_id),
        )
        conn.commit()

    # ------------------------------------------------------------------
    # FTS5 helpers
    # ------------------------------------------------------------------

    def _rebuild_fts_entry(self, conn: sqlite3.Connection, memory_id: str) -> None:
        """Delete and re-insert the FTS entry for a given memory."""
        conn.execute("DELETE FROM memories_fts WHERE memory_id = ?", (memory_id,))

        mem = conn.execute(
            "SELECT content, summary FROM memories WHERE id = ?", (memory_id,)
        ).fetchone()
        if mem is None:
            return

        # Aggregate media descriptions
        media_descs = conn.execute(
            "SELECT description FROM memory_media WHERE memory_id = ? AND description IS NOT NULL",
            (memory_id,),
        ).fetchall()
        media_desc = " ".join(r[0] for r in media_descs)

        conn.execute(
            """
            INSERT INTO memories_fts (memory_id, content, summary, media_description)
            VALUES (?, ?, ?, ?)
            """,
            (
                memory_id,
                mem["content"] if mem["content"] is not None else "",
                mem["summary"] if mem["summary"] is not None else "",
                media_desc,
            ),
        )

    def search_fts(
        self,
        query: str,
        *,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Search memories using FTS5 MATCH.

        Returns active memories matching the query, ranked by FTS relevance.
        Searches across content, summary, and media description fields.
        """
        conn = self._get_conn()
        # Escape special FTS5 characters in query
        safe_query = query.replace('"', '""').replace("*", "").replace("^", "")

        rows = conn.execute(
            """
            SELECT m.*, rank
            FROM memories_fts fts
            JOIN memories m ON m.id = fts.memory_id
            WHERE memories_fts MATCH ?
              AND m.is_active = 1
            ORDER BY rank
            LIMIT ?
            """,
            (f'"{safe_query}"', limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def search_fts_raw(
        self,
        fts_expression: str,
        *,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Search memories using a raw FTS5 MATCH expression."""
        conn = self._get_conn()
        rows = conn.execute(
            """
            SELECT m.*, rank
            FROM memories_fts fts
            JOIN memories m ON m.id = fts.memory_id
            WHERE memories_fts MATCH ?
              AND m.is_active = 1
            ORDER BY rank
            LIMIT ?
            """,
            (fts_expression, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Batch operations
    # ------------------------------------------------------------------

    def batch_upsert(self, memories: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Insert multiple memories atomically.

        If any insert fails (e.g. duplicate fingerprint), the entire batch
        is rolled back and ``sqlite3.IntegrityError`` is raised.

        Parameters
        ----------
        memories : list of dict
            Each dict should have the same keys as ``create_memory()`` kwargs.

        Returns
        -------
        list of dict
            The created memory rows.
        """
        if not memories:
            return []

        conn = self._get_conn()
        created: list[dict[str, Any]] = []

        # Use explicit transaction
        conn.execute("SAVEPOINT batch_upsert")
        try:
            for mem_kwargs in memories:
                memory_id = uuid.uuid4().hex
                now = self._now_iso()

                conn.execute(
                    """
                    INSERT INTO memories
                        (id, kind, modality, content, summary, source_run_id,
                         source_action_id, importance, confidence, access_count,
                         last_accessed_at, created_at, updated_at, fingerprint, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, 1)
                    """,
                    (
                        memory_id,
                        mem_kwargs["kind"],
                        mem_kwargs["modality"],
                        mem_kwargs.get("content", ""),
                        mem_kwargs.get("summary"),
                        mem_kwargs.get("source_run_id"),
                        mem_kwargs.get("source_action_id"),
                        mem_kwargs.get("importance", 0.5),
                        mem_kwargs.get("confidence", 0.5),
                        now,
                        now,
                        mem_kwargs["fingerprint"],
                    ),
                )

                # FTS index
                conn.execute(
                    """
                    INSERT INTO memories_fts (memory_id, content, summary, media_description)
                    VALUES (?, ?, ?, '')
                    """,
                    (
                        memory_id,
                        mem_kwargs.get("content", ""),
                        mem_kwargs.get("summary") if mem_kwargs.get("summary") is not None else "",
                    ),
                )

                row = conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
                created.append(dict(row))

            conn.execute("RELEASE SAVEPOINT batch_upsert")
        except Exception:
            conn.execute("ROLLBACK TO SAVEPOINT batch_upsert")
            raise

        return created

    # ------------------------------------------------------------------
    # Embedding CRUD
    # ------------------------------------------------------------------

    def store_embedding(
        self,
        *,
        memory_id: str,
        model: str,
        task_type: str,
        dimensions: int,
        vector: list[float],
        vector_norm: float,
    ) -> None:
        """Store a packed float32 embedding vector.

        Raises ``sqlite3.IntegrityError`` on duplicate (memory_id, task_type).
        """
        conn = self._get_conn()
        blob = struct.pack(f"{len(vector)}f", *vector)
        now = self._now_iso()

        conn.execute(
            """
            INSERT INTO memory_embeddings
                (memory_id, model, task_type, dimensions, vector_blob, vector_norm, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (memory_id, model, task_type, dimensions, blob, vector_norm, now),
        )
        conn.commit()

    def get_embedding(
        self,
        memory_id: str,
        *,
        task_type: str,
    ) -> dict[str, Any] | None:
        """Retrieve and unpack an embedding by (memory_id, task_type).

        Returns a dict with all columns plus ``vector`` as a list of floats,
        or None if not found.
        """
        conn = self._get_conn()
        row = conn.execute(
            """
            SELECT * FROM memory_embeddings
            WHERE memory_id = ? AND task_type = ?
            """,
            (memory_id, task_type),
        ).fetchone()

        if row is None:
            return None

        result = dict(row)
        blob = result.pop("vector_blob")
        n = result["dimensions"]
        result["vector"] = list(struct.unpack(f"{n}f", blob))
        return result

    def get_embedding_metadata_for_memory(self, memory_id: str) -> list[dict[str, Any]]:
        """Return embedding metadata rows for one memory (no raw vector blob)."""
        conn = self._get_conn()
        rows = conn.execute(
            """
            SELECT memory_id, model, task_type, dimensions, vector_norm, created_at
            FROM memory_embeddings
            WHERE memory_id = ?
            ORDER BY created_at
            """,
            (memory_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_active_embeddings(
        self,
        *,
        task_type: str,
    ) -> list[dict[str, Any]]:
        """Return active memories joined with embeddings for a task type.

        Each row includes memory fields plus embedding metadata and an
        unpacked ``vector`` list.
        """
        conn = self._get_conn()
        rows = conn.execute(
            """
            SELECT
                m.id,
                m.kind,
                m.modality,
                m.content,
                m.summary,
                m.source_run_id,
                m.source_action_id,
                m.importance,
                m.confidence,
                m.access_count,
                m.last_accessed_at,
                m.created_at,
                m.updated_at,
                m.fingerprint,
                m.is_active,
                e.model,
                e.task_type,
                e.dimensions,
                e.vector_blob,
                e.vector_norm,
                e.created_at AS embedding_created_at
            FROM memory_embeddings e
            JOIN memories m ON m.id = e.memory_id
            WHERE m.is_active = 1
              AND e.task_type = ?
            """,
            (task_type,),
        ).fetchall()

        results: list[dict[str, Any]] = []
        for row in rows:
            data = dict(row)
            blob = data.pop("vector_blob")
            dimensions = int(data["dimensions"])
            data["vector"] = list(struct.unpack(f"{dimensions}f", blob))
            results.append(data)

        return results

    def reinforce_memory(
        self,
        memory_id: str,
        *,
        increment_by: int = 1,
    ) -> dict[str, Any] | None:
        """Reinforce an active memory by incrementing access_count.

        Also refreshes ``updated_at``. Returns the updated memory row, or
        ``None`` when the memory does not exist or is inactive.
        """
        conn = self._get_conn()
        existing = conn.execute(
            "SELECT id FROM memories WHERE id = ? AND is_active = 1",
            (memory_id,),
        ).fetchone()
        if existing is None:
            return None

        now = self._now_iso()
        conn.execute(
            """
            UPDATE memories
            SET access_count = access_count + ?,
                updated_at = ?
            WHERE id = ?
            """,
            (increment_by, now, memory_id),
        )
        conn.commit()
        return self.get_memory(memory_id)

    # ------------------------------------------------------------------
    # Media CRUD
    # ------------------------------------------------------------------

    def create_media(
        self,
        *,
        memory_id: str,
        mime_type: str,
        file_path: str | None = None,
        data_blob: bytes | None = None,
        file_size_bytes: int | None = None,
        duration_seconds: float | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        """Insert a media record linked to a parent memory.

        Also updates the FTS index to include the media description.
        Raises ``sqlite3.IntegrityError`` if memory_id does not exist.
        """
        conn = self._get_conn()
        media_id = uuid.uuid4().hex
        now = self._now_iso()

        conn.execute(
            """
            INSERT INTO memory_media
                (id, memory_id, mime_type, file_path, data_blob,
                 file_size_bytes, duration_seconds, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                media_id,
                memory_id,
                mime_type,
                file_path,
                data_blob,
                file_size_bytes,
                duration_seconds,
                description,
                now,
            ),
        )

        # Rebuild FTS entry to include the new media description
        if description is not None:
            self._rebuild_fts_entry(conn, memory_id)

        conn.commit()

        row = conn.execute("SELECT * FROM memory_media WHERE id = ?", (media_id,)).fetchone()
        return dict(row)

    def get_media(self, media_id: str) -> dict[str, Any] | None:
        """Retrieve a media record by its ID."""
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM memory_media WHERE id = ?", (media_id,)).fetchone()
        return self._row_to_dict(row)

    def get_media_for_memory(self, memory_id: str) -> list[dict[str, Any]]:
        """Retrieve all media records for a given memory."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM memory_media WHERE memory_id = ? ORDER BY created_at",
            (memory_id,),
        ).fetchall()
        return [dict(r) for r in rows]
