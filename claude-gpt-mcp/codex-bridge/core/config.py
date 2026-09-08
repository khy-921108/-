"""config.json loading. DESIGN.md §1.4.

Missing or malformed config is a Fatal (grade 4): every tool must refuse
with the same message rather than silently falling back to defaults.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .errors import Fatal

_REQUIRED_SHAPE: dict[str, list[str]] = {
    "codex": ["command", "sandbox", "timeout_sec"],
    "limits": ["max_input_chars", "file_handoff_chars", "max_debate_rounds", "allowed_roots"],
    "session": ["dir", "retention_days", "lock_timeout_sec"],
    "preflight": ["cache_sec"],
    "logging": ["dir", "level", "log_bodies", "slow_call_sec"],
}

DEFAULT_CONFIG_PATH = "config.json"
EXAMPLE_CONFIG_PATH = "config.example.json"


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        raise Fatal(
            f"config.json 없음: {p}",
            f"{EXAMPLE_CONFIG_PATH}를 복사해 {p} 만들고 allowed_roots를 채우세요.",
        )
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise Fatal(f"config.json 파싱 실패: {exc}", f"{p} 문법을 확인하세요.") from exc

    missing: list[str] = []
    for section, keys in _REQUIRED_SHAPE.items():
        if section not in data or not isinstance(data[section], dict):
            missing.append(section)
            continue
        for key in keys:
            if key not in data[section]:
                missing.append(f"{section}.{key}")
    if missing:
        raise Fatal(
            f"config.json 필드 누락: {', '.join(missing)}",
            f"{EXAMPLE_CONFIG_PATH}와 비교해 누락 필드를 채우세요.",
        )
    if data["codex"].get("sandbox") != "read-only":
        # Not fatal - flagged as a warning at preflight time (§7 안전장치).
        data.setdefault("_warnings", []).append(
            f"codex.sandbox={data['codex'].get('sandbox')!r} — read-only가 아닙니다"
        )
    return data


def config_path_from_env(default: str = DEFAULT_CONFIG_PATH) -> str:
    import os

    return os.environ.get("CODEX_BRIDGE_CONFIG", default)
