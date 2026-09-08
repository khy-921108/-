"""Shared pytest fixtures.

No test here talks to the real Codex CLI or ChatGPT - that round trip is
the one thing DESIGN.md §0.1 flags as unverified in this environment
(no network egress, no ChatGPT login). Instead every test drives a small
fake `codex` executable (see FAKE_CODEX_SOURCE) that speaks the same
JSONL shape we confirmed against the real Codex CLI 0.153.4:
thread.started -> turn.started -> (answer) -> exit code, with the final
message written to the -o file. If the real CLI's event names for the
in-stream agent message differ from our best-effort fallback parsing,
that only affects codex_runner._extract_message_from_events, which is
never exercised by default here.
"""
from __future__ import annotations

import json
import stat
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from tools._common import BridgeContext  # noqa: E402

FAKE_CODEX_SOURCE = r'''#!/usr/bin/env python3
import json, sys, time

args = sys.argv[1:]

if args[:1] == ["--version"]:
    print("codex-cli 0.153.4 (fake)")
    sys.exit(0)

if args[:2] == ["login", "status"]:
    print("Logged in as test@example.com")
    sys.exit(0)

if args[:1] == ["delete"]:
    sys.exit(0)

if args[:1] != ["exec"]:
    print(f"unhandled: {args}", file=sys.stderr)
    sys.exit(2)

rest = args[1:]
resume_thread = None
output_last_message = None
if rest[:1] == ["resume"]:
    rest = rest[1:]
    i = 0
    while i < len(rest):
        if rest[i] == "-o":
            output_last_message = rest[i + 1]; i += 2; continue
        if rest[i] in ("--output-schema", "-m"):
            i += 2; continue
        if rest[i] == "--json":
            i += 1; continue
        if not rest[i].startswith("-") and resume_thread is None:
            resume_thread = rest[i]
        i += 1
else:
    i = 0
    while i < len(rest):
        if rest[i] == "-o":
            output_last_message = rest[i + 1]; i += 2; continue
        if rest[i] in ("-s", "-C", "--output-schema", "-m"):
            i += 2; continue
        i += 1

prompt = sys.stdin.read()

print(json.dumps({"type": "thread.started", "thread_id": resume_thread or "th-fake-0001"}))
sys.stdout.flush()
print(json.dumps({"type": "turn.started"}))
sys.stdout.flush()

if "TRIGGER_TIMEOUT" in prompt:
    time.sleep(5)
    sys.exit(0)

if "TRIGGER_LIMIT" in prompt:
    print(json.dumps({"type": "error", "message": "You've hit your usage limit for gpt-5.2-codex."}))
    sys.exit(1)

if "TRIGGER_AUTH" in prompt:
    print("Not logged in. Please run 'codex login'.", file=sys.stderr)
    sys.exit(1)

if "TRIGGER_BADEXIT" in prompt:
    sys.exit(7)

if "TRIGGER_RECONNECT" in prompt:
    print(json.dumps({"type": "error", "message": "Reconnecting... 1/5 (stream disconnected)"}))
    sys.stdout.flush()

answer = f"resumed:{resume_thread}:{prompt.strip()}" if resume_thread else f"echo:{prompt.strip()}"
if "TRIGGER_JSON_REVIEW" in prompt:
    answer = json.dumps({"summary": "ok", "findings": []})
elif "TRIGGER_JSON_CROSS" in prompt:
    answer = json.dumps({"verdict": "agree", "items": [], "missing_points": []})
elif "TRIGGER_JSON_DEBATE" in prompt:
    answer = json.dumps({"rebuttal": "r", "additions": "a", "agreed": [], "open_issues": []})

if output_last_message:
    with open(output_last_message, "w", encoding="utf-8") as fh:
        fh.write(answer)

print(json.dumps({"type": "item.completed", "text": answer}))
sys.exit(0)
'''


@pytest.fixture
def fake_codex(tmp_path: Path) -> str:
    path = tmp_path / "fake_codex.py"
    path.write_text(FAKE_CODEX_SOURCE, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return str(path)


@pytest.fixture
def bridge_config(tmp_path: Path, fake_codex: str) -> dict:
    example = json.loads((REPO_ROOT / "config.example.json").read_text(encoding="utf-8"))
    example["codex"]["command"] = fake_codex
    example["session"]["dir"] = str(tmp_path / "sessions")
    example["session"]["lock_timeout_sec"] = 2
    example["logging"]["dir"] = str(tmp_path / "logs")
    example["limits"]["allowed_roots"] = [str(tmp_path)]
    example["codex"]["timeout_sec"] = 5
    return example


@pytest.fixture
def ctx(bridge_config: dict) -> BridgeContext:
    return BridgeContext.build(bridge_config)
