"""Bridge session <-> Codex thread mapping. DESIGN.md §4.3.

Two different locks are at play:
  - a short-lived lock around map.json itself, so two calls that finish
    around the same time don't clobber each other's write (temp -> .bak
    -> rename -> reread, per DESIGN.md §7)
  - a per-session lock held for the *whole* STEP 2..6 span, so two calls
    against the same session_id (e.g. a debate round fired twice) don't
    both `codex exec resume` the same thread at once. Different sessions
    use different lock files and run fully in parallel.

The conversation transcript itself is never stored here - only the
mapping, round counter, and a short call history. Codex keeps the
transcript in its own session store.
"""
from __future__ import annotations

import json
import os
import secrets
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from filelock import FileLock, Timeout

from .errors import Halt

_MAX_CALLS_KEPT = 50


@dataclass
class Session:
    id: str
    tool: str
    cwd: str | None = None
    thread_id: str | None = None
    round: int = 0
    created: str = ""
    last: str = ""
    calls: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Session":
        return Session(
            id=data["id"], tool=data.get("tool", ""), cwd=data.get("cwd"),
            thread_id=data.get("thread_id"), round=data.get("round", 0),
            created=data.get("created", ""), last=data.get("last", ""),
            calls=data.get("calls", []),
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_session_id() -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{secrets.token_hex(2)}"


class SessionMap:
    def __init__(self, base_dir: str | Path, lock_timeout_sec: int = 10):
        self.dir = Path(base_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.locks_dir = self.dir / ".locks"
        self.locks_dir.mkdir(parents=True, exist_ok=True)
        self.map_path = self.dir / "map.json"
        self.bak_path = self.dir / "map.json.bak"
        self._map_guard = FileLock(str(self.dir / "map.json.guard"), timeout=5)
        self.lock_timeout_sec = lock_timeout_sec

    # -- per-session call serialization ---------------------------------

    @contextmanager
    def lock(self, session_id: str, timeout: float | None = None) -> Iterator[None]:
        lock_path = self.locks_dir / f"{session_id}.lock"
        fl = FileLock(str(lock_path), timeout=timeout or self.lock_timeout_sec)
        try:
            with fl:
                yield
        except Timeout as exc:
            raise Halt(
                f"세션 잠금 대기 초과: {session_id}",
                "다른 호출이 끝난 뒤 다시 시도하세요.",
            ) from exc

    # -- map.json read/write ---------------------------------------------

    def _read_map_raw(self) -> dict[str, Any]:
        if not self.map_path.exists():
            return {}
        try:
            return json.loads(self.map_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            if self.bak_path.exists():
                return json.loads(self.bak_path.read_text(encoding="utf-8"))
            raise

    def create(self, tool: str, cwd: str | None) -> Session:
        now = _now_iso()
        return Session(id=new_session_id(), tool=tool, cwd=cwd, created=now, last=now)

    def load(self, session_id: str) -> Session:
        with self._map_guard:
            raw = self._read_map_raw()
        if session_id not in raw:
            raise Halt(
                f"세션 없음: {session_id}",
                "gpt_session action=list로 존재하는 세션을 확인하세요.",
            )
        return Session.from_dict(raw[session_id])

    def bind(self, session: Session, thread_id: str) -> None:
        if not session.thread_id:
            session.thread_id = thread_id

    def bump_round(self, session: Session) -> int:
        session.round += 1
        return session.round

    def record_call(self, session: Session, request_id: str, elapsed_sec: float, grade: int) -> None:
        session.calls.append({
            "request_id": request_id, "elapsed_sec": round(elapsed_sec, 2),
            "grade": grade, "at": _now_iso(),
        })
        session.calls = session.calls[-_MAX_CALLS_KEPT:]
        session.last = _now_iso()

    def save(self, session: Session) -> None:
        """temp -> .bak rotate -> rename -> reread verify (DESIGN.md §7)."""
        with self._map_guard:
            raw = self._read_map_raw()
            raw[session.id] = session.to_dict()
            self._write_raw(raw)

    def _write_raw(self, raw: dict[str, Any]) -> None:
        tmp_path = self.map_path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
        if self.map_path.exists():
            self.map_path.replace(self.bak_path)
        tmp_path.replace(self.map_path)
        # Reread to verify the write actually landed (§7 파일 손상 방지).
        reread = json.loads(self.map_path.read_text(encoding="utf-8"))
        if reread != raw:
            if self.bak_path.exists():
                self.bak_path.replace(self.map_path)
            raise Halt(
                "세션 저장 검증 실패 (재읽기 불일치)",
                "이전 버전(.bak)으로 복구했습니다. 다시 시도하세요.",
            )

    def delete(self, session_id: str) -> str | None:
        with self._map_guard:
            raw = self._read_map_raw()
            entry = raw.pop(session_id, None)
            if entry is not None:
                self._write_raw(raw)
        return entry.get("thread_id") if entry else None

    def list_sessions(self) -> list[dict[str, Any]]:
        with self._map_guard:
            raw = self._read_map_raw()
        return [
            {
                "id": sid, "tool": v.get("tool"), "thread_id": v.get("thread_id"),
                "round": v.get("round", 0), "created": v.get("created"), "last": v.get("last"),
                "call_count": len(v.get("calls", [])),
            }
            for sid, v in raw.items()
        ]

    def purge(self, retention_days: int) -> list[tuple[str, str | None]]:
        """Removes sessions whose `last` is older than retention_days.

        Returns [(session_id, thread_id), ...] for the caller (gpt_session)
        to also try `codex delete <thread_id>` on - a best-effort cleanup
        that's allowed to fail (grade 2), per DESIGN.md §7.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        removed: list[tuple[str, str | None]] = []
        with self._map_guard:
            raw = self._read_map_raw()
            for sid in list(raw.keys()):
                last_raw = raw[sid].get("last") or raw[sid].get("created")
                try:
                    last_dt = datetime.fromisoformat(last_raw)
                except (TypeError, ValueError):
                    continue
                if last_dt < cutoff:
                    removed.append((sid, raw[sid].get("thread_id")))
                    del raw[sid]
            if removed:
                self._write_raw(raw)
        return removed
