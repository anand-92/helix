"""Structured logging configuration for Helix.

Call ``setup_logging()`` once at application startup (server or CLI).
Every module should then obtain a logger via::

    import structlog
    logger = structlog.get_logger()

Stdlib ``logging.getLogger()`` calls are automatically routed through structlog
processors, so existing code continues to work without changes.
"""

from __future__ import annotations

import logging
import sys

import structlog


def setup_logging(*, json_output: bool = False, level: int = logging.INFO) -> None:
    """Configure structlog and the stdlib logging bridge.

    Parameters
    ----------
    json_output:
        When *True*, emit machine-readable JSON lines (suitable for log
        aggregators).  When *False* (default), emit human-friendly coloured
        console output.
    level:
        Root log level.
    """
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if json_output:
        renderer: structlog.types.Processor = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
        foreign_pre_chain=shared_processors,
    )

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Force uvicorn's loggers to propagate through the root handler
    # instead of using their own formatters.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers.clear()
        uv_logger.propagate = True
