"""Media file management for Helix's memory subsystem.

Handles storage of media files (images, audio, video, PDF) using a
size-based strategy: small files (under configurable threshold) are
stored as inline blobs in the database; large files are written to
disk under a configurable directory.  Provides MIME type detection
from magic bytes and base64 encoding for the Gemini embedding API.
"""

import base64
import uuid
from pathlib import Path
from typing import Any

import structlog

from memory.store import MemoryStore

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# MIME type detection — magic bytes signatures
# ---------------------------------------------------------------------------

_MIME_SIGNATURES: list[tuple[bytes, int, str]] = [
    # (magic_bytes, offset, mime_type)
    (b"\x89PNG\r\n\x1a\n", 0, "image/png"),
    (b"\xff\xd8\xff", 0, "image/jpeg"),
    (b"RIFF", 0, "audio/wav"),  # WAV: starts with RIFF, has WAVE at offset 8
    (b"\xff\xfb", 0, "audio/mpeg"),  # MP3 frame sync
    (b"\xff\xf3", 0, "audio/mpeg"),  # MP3 frame sync (MPEG 2.5)
    (b"\xff\xf2", 0, "audio/mpeg"),  # MP3 frame sync variant
    (b"ID3", 0, "audio/mpeg"),  # MP3 with ID3 tag
    (b"%PDF", 0, "application/pdf"),
]

# MP4 is special: ftyp box can appear at offset 4 with variable box size
_MP4_FTYP = b"ftyp"

# Mapping of mime_type to common file extensions
_MIME_TO_EXT: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
    "application/octet-stream": ".bin",
}


# ---------------------------------------------------------------------------
# MediaManager
# ---------------------------------------------------------------------------


class MediaManager:
    """Manages media file storage, retrieval, and base64 encoding.

    Storage strategy:
    - Files <= ``inline_max_bytes`` are stored as ``data_blob`` in the
      ``memory_media`` table with ``file_path = NULL``.
    - Files > ``inline_max_bytes`` are written to disk under ``media_dir``
      with ``data_blob = NULL`` and ``file_path`` pointing to the file.

    Parameters
    ----------
    store : MemoryStore
        The backing store for database operations.
    media_dir : Path | str
        Directory for storing large media files on disk.
    inline_max_bytes : int
        Maximum size in bytes for inline blob storage (default 262144 = 256KB).
    """

    def __init__(
        self,
        store: MemoryStore,
        media_dir: Path | str,
        inline_max_bytes: int = 262144,
    ) -> None:
        self._store = store
        self._media_dir = Path(media_dir)
        self._inline_max_bytes = inline_max_bytes

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def store_media(
        self,
        memory_id: str,
        data_bytes: bytes,
        mime_type: str,
        description: str | None = None,
        duration_seconds: float | None = None,
    ) -> str:
        """Store media data, choosing inline blob or disk file by size.

        Parameters
        ----------
        memory_id : str
            ID of the parent memory this media is attached to.
        data_bytes : bytes
            Raw media content.
        mime_type : str
            MIME type of the media (e.g. ``"image/png"``).
        description : str, optional
            Text description of the media content.
        duration_seconds : float, optional
            Duration in seconds for audio/video media.

        Returns
        -------
        str
            The ID of the created media record.
        """
        file_size = len(data_bytes)
        file_path: str | None = None
        data_blob: bytes | None = None

        if file_size <= self._inline_max_bytes:
            # Small file: store as inline blob
            data_blob = data_bytes
        else:
            # Large file: write to disk
            file_path = self._write_to_disk(data_bytes, mime_type)

        media_record = self._store.create_media(
            memory_id=memory_id,
            mime_type=mime_type,
            file_path=file_path,
            data_blob=data_blob,
            file_size_bytes=file_size,
            duration_seconds=duration_seconds,
            description=description,
        )

        return str(media_record["id"])

    def get_media(self, media_id: str) -> dict[str, Any] | None:
        """Retrieve a media record by its ID.

        Returns the full media record dict, or ``None`` if not found.
        """
        return self._store.get_media(media_id)

    def get_media_for_memory(self, memory_id: str) -> list[dict[str, Any]]:
        """Retrieve all media records for a given parent memory.

        Returns a list of media record dicts (may be empty).
        """
        return self._store.get_media_for_memory(memory_id)

    def prepare_for_embedding(
        self,
        media_record: dict[str, Any],
    ) -> str | None:
        """Return base64-encoded data suitable for Gemini API inline_data format.

        Reads from ``data_blob`` (inline storage) or ``file_path`` (disk
        storage), whichever is available.

        Returns ``None`` if neither source has data.
        """
        data: bytes | None = None

        if media_record.get("data_blob") is not None:
            data = media_record["data_blob"]
        elif media_record.get("file_path") is not None:
            file_path = Path(media_record["file_path"])
            if file_path.exists():
                data = file_path.read_bytes()
            else:
                logger.warning("Media file not found on disk: %s", media_record["file_path"])
                return None

        if data is None:
            return None

        return base64.b64encode(data).decode("ascii")

    def detect_mime_type(
        self,
        file_path_or_bytes: str | bytes | Path,
    ) -> str:
        """Detect the MIME type from magic bytes.

        Accepts raw bytes or a file path (str or Path). Reads the first
        16 bytes of a file if a path is provided.

        Returns the detected MIME type string, or
        ``"application/octet-stream"`` if unknown.
        """
        if isinstance(file_path_or_bytes, str | Path):
            path = Path(file_path_or_bytes)
            header = path.read_bytes()[:16]
        else:
            header = file_path_or_bytes[:16]

        return self._detect_from_header(header)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _write_to_disk(self, data: bytes, mime_type: str) -> str:
        """Write data to a UUID-named file under ``media_dir``.

        Creates ``media_dir`` if it doesn't exist.

        Returns the absolute file path as a string.
        """
        self._media_dir.mkdir(parents=True, exist_ok=True)

        ext = _MIME_TO_EXT.get(mime_type, ".bin")
        filename = f"{uuid.uuid4().hex}{ext}"
        file_path = self._media_dir / filename

        file_path.write_bytes(data)
        return str(file_path)

    @staticmethod
    def _detect_from_header(header: bytes) -> str:
        """Match header bytes against known MIME signatures."""
        # Check MP4 specially: ftyp appears at offset 4
        if len(header) >= 8 and header[4:8] == _MP4_FTYP:
            return "video/mp4"

        for magic, offset, mime_type in _MIME_SIGNATURES:
            end = offset + len(magic)
            if len(header) >= end and header[offset:end] == magic:
                # WAV: verify WAVE marker at offset 8
                if mime_type == "audio/wav" and len(header) >= 12 and header[8:12] != b"WAVE":
                    continue
                return mime_type

        return "application/octet-stream"
