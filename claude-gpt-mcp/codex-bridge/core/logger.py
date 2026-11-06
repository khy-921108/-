"""Per-day file logging. DESIGN.md §4.5.

stdout is the MCP protocol channel - this module never writes to it.
Every line goes to the day's log file and to stderr.
"""
from __future__ import annotations

import json
import logging
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{10,}"),
    re.compile(r"\b\d{2,3}-\d{3,4}-\d{4}\b"),  # phone
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),  # email
]


def mask(text: str) -> str:
    for pat in _SECRET_PATTERNS:
        text = pat.sub("***", text)
    return text


@dataclass
class CallRecord:
    request_id: str
    tool: str
    grade: int = 0
    session_id: str | None = None
    thread_id: str | None = None
    model: str | None = None
    elapsed_sec: float | None = None
    exit_code: int | None = None
    reconnects: int = 0
    message: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def line(self) -> str:
        parts = [
            f"grade={self.grade}",
            f"request_id={self.request_id}",
            f"tool={self.tool}",
            f"session={self.session_id or '-'}",
            f"thread={self.thread_id or '-'}",
            f"model={self.model or '-'}",
            f"elapsed={self.elapsed_sec if self.elapsed_sec is not None else '-'}",
            f"exit={self.exit_code if self.exit_code is not None else '-'}",
            f"reconnects={self.reconnects}",
        ]
        msg = mask(self.message)
        return " ".join(parts) + (f" msg={msg!r}" if msg else "")


class BridgeLogger:
    """Wraps a stdlib logger writing to logs/YYYY-MM-DD.log + stderr."""

    def __init__(self, log_dir: str | Path, level: str = "INFO", log_bodies: bool = False):
        self.dir = Path(log_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.log_bodies = log_bodies
        # A name unique to this directory (not just "codex_bridge") - `logging.getLogger`
        # caches by name process-wide, so two instances pointed at different
        # directories must not collide on the same logger/handlers.
        self._logger = logging.getLogger(f"codex_bridge.{self.dir.resolve()}")
        self._logger.setLevel(getattr(logging, level.upper(), logging.INFO))
        self._logger.propagate = False
        if not self._logger.handlers:
            fmt = logging.Formatter("%(asctime)s %(message)s")
            stderr_handler = logging.StreamHandler(sys.stderr)
            stderr_handler.setFormatter(fmt)
            self._logger.addHandler(stderr_handler)
            self._file_handler = _DailyFileHandler(self.dir)
            self._file_handler.setFormatter(fmt)
            self._logger.addHandler(self._file_handler)

    def call(self, record: CallRecord) -> None:
        self._logger.info(record.line())

    def body(self, request_id: str, label: str, text: str) -> None:
        if not self.log_bodies:
            return
        # Gated by the log_bodies flag alone, not the logger's level, so
        # turning bodies on doesn't require also lowering the log level.
        self._logger.log(logging.INFO, f"request_id={request_id} {label}={mask(text)!r}")

    def debug(self, text: str) -> None:
        self._logger.debug(mask(text))

    def error(self, text: str, exc: BaseException | None = None) -> None:
        if exc is not None:
            self._logger.error(mask(text), exc_info=exc)
        else:
            self._logger.error(mask(text))


class _DailyFileHandler(logging.Handler):
    """Opens logs/YYYY-MM-DD.log lazily and reopens when the date rolls over."""

    def __init__(self, directory: Path):
        super().__init__()
        self.directory = directory
        self._current_date: str | None = None
        self._stream = None

    def _ensure_stream(self):
        import datetime

        today = datetime.date.today().isoformat()
        if today != self._current_date:
            if self._stream:
                self._stream.close()
            self._current_date = today
            self._stream = open(self.directory / f"{today}.log", "a", encoding="utf-8")
        return self._stream

    def emit(self, record: logging.LogRecord) -> None:
        try:
            stream = self._ensure_stream()
            stream.write(self.format(record) + "\n")
            stream.flush()
        except Exception:
            self.handleError(record)


def new_request_id() -> str:
    import uuid

    return uuid.uuid4().hex[:12]
