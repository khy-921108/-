"""Input/session/response validation and preflight checks. DESIGN.md §4.4, §6.

Every check here either passes silently, appends a grade-2 warning, or
raises Halt/Fatal. Nothing here calls codex exec - that belongs to
codex_runner.py.
"""
from __future__ import annotations

import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import Fatal, Halt

_LIMIT_HIT_RE = re.compile(r"hit your usage limit", re.IGNORECASE)
_AUTH_ERROR_RE = re.compile(
    r"not logged in|not signed in|api key auth is not supported|401|unauthorized",
    re.IGNORECASE,
)


@dataclass
class PreflightResult:
    ok: bool
    codex_version: str | None
    logged_in: bool
    issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checked_at: float = field(default_factory=time.time)


class Preflight:
    """Caches the (slow-ish) install/login check for `cache_sec` seconds."""

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self._cached: PreflightResult | None = None

    def check(self, force: bool = False) -> PreflightResult:
        cache_sec = self.config["preflight"]["cache_sec"]
        now = time.time()
        if not force and self._cached and (now - self._cached.checked_at) < cache_sec:
            return self._cached
        result = self._run()
        self._cached = result
        return result

    def _run(self) -> PreflightResult:
        issues: list[str] = []
        warnings: list[str] = list(self.config.get("_warnings", []))
        codex_cmd = self.config["codex"]["command"]

        version = None
        try:
            proc = subprocess.run(
                [codex_cmd, "--version"], capture_output=True, text=True, timeout=15
            )
            if proc.returncode == 0:
                version = proc.stdout.strip() or proc.stderr.strip()
            else:
                issues.append(f"'{codex_cmd} --version' 실패 (exit {proc.returncode})")
        except FileNotFoundError:
            issues.append(f"'{codex_cmd}' 명령을 찾을 수 없음")
        except subprocess.TimeoutExpired:
            issues.append(f"'{codex_cmd} --version' 15초 타임아웃")

        logged_in = False
        if not issues:
            try:
                proc = subprocess.run(
                    [codex_cmd, "login", "status"], capture_output=True, text=True, timeout=15
                )
                out = (proc.stdout + proc.stderr).strip()
                if proc.returncode == 0 and not _AUTH_ERROR_RE.search(out):
                    logged_in = True
                else:
                    issues.append(f"Codex 로그인 필요: {out or 'Not logged in'}")
            except subprocess.TimeoutExpired:
                issues.append(f"'{codex_cmd} login status' 15초 타임아웃")

        allowed_roots = self.config["limits"]["allowed_roots"]
        if not allowed_roots:
            warnings.append("limits.allowed_roots가 비어 있음 — cwd를 지정하는 모든 호출이 거부됩니다")
        else:
            for root in allowed_roots:
                if not Path(root).exists():
                    warnings.append(f"allowed_roots 항목이 존재하지 않음: {root}")

        for key in ("session", "logging"):
            dir_path = Path(self.config[key]["dir"])
            try:
                dir_path.mkdir(parents=True, exist_ok=True)
                probe = dir_path / ".write_test"
                probe.write_text("ok", encoding="utf-8")
                probe.unlink()
            except OSError as exc:
                issues.append(f"{dir_path} 쓰기 불가: {exc}")

        return PreflightResult(
            ok=not issues, codex_version=version, logged_in=logged_in,
            issues=issues, warnings=warnings,
        )


def require_ok(preflight: Preflight) -> PreflightResult:
    result = preflight.check()
    if not result.ok:
        raise Fatal(
            "사전점검 실패: " + "; ".join(result.issues),
            "설치: npm install -g @openai/codex · 로그인: codex login",
        )
    return result


def check_input(text: str, max_chars: int) -> None:
    if len(text) > max_chars:
        raise Halt(
            f"입력 길이 초과 ({len(text):,} / {max_chars:,}자)",
            "입력을 줄이거나 파일로 전달하세요.",
        )


def check_cwd(cwd: str | None, allowed_roots: list[str]) -> str | None:
    if cwd is None:
        return None
    if not allowed_roots:
        raise Halt(
            "허용 폴더(allowed_roots)가 설정되지 않음",
            "config.json limits.allowed_roots에 폴더를 추가하세요.",
        )
    target = Path(cwd).resolve()
    for root in allowed_roots:
        root_p = Path(root).resolve()
        if target == root_p or root_p in target.parents:
            return str(target)
    raise Halt(
        f"cwd가 허용 폴더 밖: {cwd}",
        f"허용 폴더: {', '.join(allowed_roots)}",
    )


def check_session_round(current_round: int, max_rounds: int) -> None:
    if current_round > max_rounds:
        raise Halt(
            f"토론 라운드 상한 초과 ({current_round} / {max_rounds})",
            "새 세션으로 다시 시작하거나 config의 max_debate_rounds를 늘리세요.",
        )


def check_events(events: list[dict]) -> str:
    if not events or events[0].get("type") != "thread.started":
        raise Halt(
            "Codex 출력 형식이 예상과 다름 (첫 이벤트가 thread.started 아님)",
            "codex --version으로 버전을 확인하고 DESIGN.md §0.1 가정을 재검증하세요.",
        )
    thread_id = events[0].get("thread_id")
    if not thread_id:
        raise Halt("thread_id 없음", "Codex 버전을 확인하세요.")
    return thread_id


def check_response(parsed: dict | None, required_keys: list[str]) -> list[str]:
    """Returns a list of grade-1 warnings; never raises (schema misses fall back to raw text)."""
    if parsed is None:
        return ["구조화 실패: 원문을 그대로 반환합니다"]
    missing = [k for k in required_keys if k not in parsed]
    if missing:
        return [f"응답 스키마 필드 누락: {', '.join(missing)}"]
    return []


def classify_failure(exit_code: int, limit_hit: bool, auth_error: bool, timed_out: bool) -> Halt | Fatal:
    if auth_error:
        return Fatal(
            "Codex 인증 오류(토큰 만료 가능)",
            "codex login으로 다시 로그인하세요.",
        )
    if limit_hit:
        return Halt(
            "ChatGPT 사용 한도 도달",
            "Codex에서 /usage로 재설정 시각을 확인한 뒤 재시도하세요. 자동 재시도는 하지 않습니다.",
        )
    if timed_out:
        return Halt("codex exec 타임아웃", "config의 codex.timeout_sec을 늘리거나 입력을 줄이세요.")
    return Halt(f"codex exec 실패 (exit {exit_code})", "logs/의 stderr 기록을 확인하세요.")
