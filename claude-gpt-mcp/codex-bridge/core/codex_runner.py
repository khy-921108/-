"""Runs `codex exec` as a child process and parses its JSONL output.

DESIGN.md §4.1. This is the ONLY module that spawns Codex. It never
retries by itself - Codex's own internal reconnect (visible as
`{"type":"error","message":"Reconnecting... n/5 ..."}` events) is left
alone, we just count it for the warning shown back to Claude.

Confirmed against Codex CLI 0.153.4 (see DESIGN.md §0.1):
  - `codex exec --json` prints JSONL: the first line is always
    {"type":"thread.started","thread_id":"..."} once auth/network is up.
  - `codex exec resume <thread_id> -` continues that thread; resume does
    NOT take -s/-C (the thread already carries its own cwd/sandbox).
  - `-o <file>` is documented to hold "the last message from the agent"
    regardless of the JSONL event shape, so it is the primary source for
    the final answer; JSONL scanning is only a fallback.
  - The exact event name for an in-stream agent message was not observed
    (this dev environment has no ChatGPT login / network egress), so
    `_extract_message_from_events` is intentionally best-effort.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_LIMIT_RE = re.compile(r"hit your usage limit", re.IGNORECASE)
_AUTH_RE = re.compile(
    r"not logged in|not signed in|api key auth is not supported|401 |unauthorized",
    re.IGNORECASE,
)
_RECONNECT_RE = re.compile(r"reconnecting", re.IGNORECASE)


@dataclass
class RunResult:
    thread_id: str | None
    last_message: str
    parsed: dict[str, Any] | None
    events: list[dict[str, Any]]
    exit_code: int
    elapsed_sec: float
    reconnects: int = 0
    limit_hit: bool = False
    auth_error: bool = False
    timed_out: bool = False
    stderr_tail: str = ""


def _kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True, check=False,
        )
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            proc.kill()


def _popen_kwargs() -> dict[str, Any]:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _parse_jsonl(stdout: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def _extract_message_from_events(events: list[dict[str, Any]]) -> str | None:
    """Best-effort fallback when -o didn't produce anything (see module docstring)."""
    for ev in reversed(events):
        for key in ("message", "text", "content"):
            val = ev.get(key)
            if isinstance(val, str) and val.strip():
                return val
    return None


def build_argv(
    codex_cmd: str,
    *,
    prompt_via_stdin: bool = True,
    resume_thread: str | None,
    sandbox: str,
    cwd: str | None,
    schema_path: str | None,
    model: str | None,
    extra_args: list[str],
    output_last_message: str,
) -> list[str]:
    argv = [codex_cmd, "exec"]
    if resume_thread:
        argv += ["resume", "--json"]
        if schema_path:
            argv += ["--output-schema", schema_path]
        if model:
            argv += ["-m", model]
        argv += ["-o", output_last_message]
        argv += [resume_thread]
    else:
        argv += ["--json", "-s", sandbox]
        if cwd:
            argv += ["-C", cwd]
        if schema_path:
            argv += ["--output-schema", schema_path]
        if model:
            argv += ["-m", model]
        argv += extra_args
        argv += ["-o", output_last_message]
    if prompt_via_stdin:
        argv += ["-"]
    return argv


def delete_thread(codex_cmd: str, thread_id: str, timeout_sec: int = 30) -> bool:
    """Best-effort `codex delete <id>` so Codex doesn't accumulate orphaned
    sessions when we drop our own mapping (DESIGN.md §7). Failure here is
    a grade-2 warning to the caller, never a grade-3/4 - the bridge's own
    mapping is already gone either way.
    """
    try:
        proc = subprocess.run(
            [codex_cmd, "delete", thread_id], capture_output=True, text=True, timeout=timeout_sec,
        )
        return proc.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def run(
    codex_cmd: str,
    prompt: str,
    *,
    cwd: str | None,
    schema_path: str | None = None,
    resume_thread: str | None = None,
    model: str | None = None,
    sandbox: str = "read-only",
    extra_args: list[str] | None = None,
    timeout_sec: int = 600,
) -> RunResult:
    extra_args = extra_args or []

    with tempfile.TemporaryDirectory(prefix="codex-bridge-") as scratch:
        output_last_message = str(Path(scratch) / "last_message.txt")
        argv = build_argv(
            codex_cmd,
            resume_thread=resume_thread, sandbox=sandbox, cwd=cwd,
            schema_path=schema_path, model=model, extra_args=extra_args,
            output_last_message=output_last_message,
        )

        started = time.monotonic()
        proc = subprocess.Popen(
            argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", **_popen_kwargs(),
        )
        timed_out = False
        try:
            stdout, stderr = proc.communicate(input=prompt, timeout=timeout_sec)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
            stdout, stderr = proc.communicate()
            timed_out = True
        elapsed = time.monotonic() - started

        events = _parse_jsonl(stdout)
        thread_id = None
        if events and events[0].get("type") == "thread.started":
            thread_id = events[0].get("thread_id")
        else:
            # Codex may print a "Reading prompt from stdin..." banner first;
            # look a little further before giving up.
            thread_id = next(
                (e.get("thread_id") for e in events if e.get("type") == "thread.started"), None
            )

        reconnects = sum(
            1 for e in events if e.get("type") == "error" and _RECONNECT_RE.search(str(e.get("message", "")))
        )

        combined_text = stdout + "\n" + stderr
        limit_hit = bool(_LIMIT_RE.search(combined_text))
        auth_error = bool(_AUTH_RE.search(combined_text))

        last_message = ""
        out_path = Path(output_last_message)
        if out_path.exists():
            last_message = out_path.read_text(encoding="utf-8", errors="replace").strip()
        if not last_message:
            last_message = _extract_message_from_events(events) or ""
        if not last_message and not timed_out:
            # Last resort: at least surface something instead of an empty string.
            last_message = stdout.strip()[-4000:]

        parsed: dict[str, Any] | None = None
        if schema_path and last_message:
            try:
                parsed = json.loads(last_message)
            except json.JSONDecodeError:
                parsed = None

        return RunResult(
            thread_id=thread_id, last_message=last_message, parsed=parsed, events=events,
            exit_code=proc.returncode if proc.returncode is not None else -1,
            elapsed_sec=elapsed, reconnects=reconnects, limit_hit=limit_hit,
            auth_error=auth_error, timed_out=timed_out, stderr_tail=stderr[-2000:],
        )
