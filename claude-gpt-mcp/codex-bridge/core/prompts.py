"""Prompt assembly. DESIGN.md §4.2.

Role instructions live in ONE place: skill/gpt-check/SKILL.md (so the
skill Claude reads and the wrapper Codex talks to never drift apart).
This module parses that file; if it's missing or a section can't be
found, it falls back to an embedded copy of the same text and reports
a grade-2 warning rather than failing the call.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

_DEFAULT_SKILL_PATH = Path(__file__).resolve().parents[2] / "skill" / "gpt-check" / "SKILL.md"

# Kept in sync with skill/gpt-check/SKILL.md "## 역할 지시" section.
# Used only when that file is missing or a section can't be parsed out of it.
_FALLBACK = {
    "prefix": (
        "당신은 다른 AI(Claude)의 결과를 독립적으로 검토하는 검토자다. "
        "상대 답을 정답으로 가정하지 말고 근거를 제시하라. 한국어로 답하라."
    ),
    "ask": "질문에 직접 답하라. 모르면 모른다고 말하고 추측임을 밝혀라.",
    "cross_check": (
        "질문과 Claude의 답, 체크리스트를 받는다. 체크리스트 순서대로 항목별 "
        "동의/불일치/누락을 판정하고 근거를 적어라. Claude의 답은 한쪽 의견이다."
    ),
    "review": (
        "코드/설계/문서를 받는다. 심각도(high/mid/low)·위치·문제·수정안으로 "
        "findings를 만들고 총평을 붙여라."
    ),
    "debate": (
        "주제와 Claude의 입장을 받는다. 반론·보완·현재까지 합의점·남은 쟁점을 "
        "정리하라. 마지막 라운드라고 표시되면 결론 제안을 반드시 포함하라."
    ),
}

# heading text (without the leading ###) -> role key
_SECTION_MARKERS = {
    "공통 접두": "prefix",
    "질문": "ask",
    "검산": "cross_check",
    "리뷰": "review",
    "토론": "debate",
}


@dataclass
class RoleSet:
    prefix: str
    ask: str
    cross_check: str
    review: str
    debate: str
    warnings: list[str] = field(default_factory=list)

    def role_text(self, role: str) -> str:
        return getattr(self, role)


def _extract_sections(markdown: str) -> dict[str, str]:
    """Pulls out ### subsections under the '## 역할 지시' heading."""
    lines = markdown.splitlines()
    found: dict[str, str] = {}
    in_role_block = False
    current_key: str | None = None
    buf: list[str] = []

    def flush():
        if current_key is not None:
            found[current_key] = "\n".join(buf).strip()

    for line in lines:
        if line.startswith("## "):
            if in_role_block:
                flush()
                break
            in_role_block = "역할 지시" in line
            continue
        if not in_role_block:
            continue
        if line.startswith("### "):
            flush()
            buf = []
            heading = line[4:].strip()
            current_key = next(
                (key for marker, key in _SECTION_MARKERS.items() if marker in heading), None
            )
            continue
        if current_key is not None:
            buf.append(line)
    else:
        if in_role_block:
            flush()
    return found


def load_roles(skill_path: str | Path | None = None) -> RoleSet:
    path = Path(skill_path) if skill_path else _DEFAULT_SKILL_PATH
    warnings: list[str] = []
    sections: dict[str, str] = {}

    if not path.exists():
        warnings.append(f"스킬 파일 없음({path}) — 내장 기본 역할 지시 사용")
    else:
        try:
            sections = _extract_sections(path.read_text(encoding="utf-8"))
        except OSError as exc:
            warnings.append(f"스킬 파일 읽기 실패({exc}) — 내장 기본 역할 지시 사용")

    values = {}
    for key, fallback_text in _FALLBACK.items():
        text = sections.get(key)
        if not text:
            if path.exists():
                warnings.append(f"스킬 파일에 '{key}' 섹션 없음 — 내장 기본값 사용")
            text = fallback_text
        values[key] = text

    return RoleSet(warnings=warnings, **values)


def build(role_text: str, prefix: str, user_input: str, checklist: list[str] | None = None) -> str:
    parts = [prefix, role_text]
    if checklist:
        numbered = "\n".join(f"{i}. {item}" for i, item in enumerate(checklist, start=1))
        parts.append(f"체크리스트(이 순서대로 판정하라):\n{numbered}")
    parts.append(user_input)
    return "\n\n".join(p for p in parts if p)


def handoff_if_large(
    text: str, limit: int, tmp_dir: str | Path
) -> tuple[str, Path | None]:
    """Swaps a long prompt for a "read this file" instruction (DESIGN.md §4.2, §6).

    Returns (prompt_text, tmp_file_or_None). The caller is responsible for
    deleting the temp file at STEP 6 once the call completes.
    """
    if len(text) <= limit:
        return text, None
    tmp_path = Path(tmp_dir)
    tmp_path.mkdir(parents=True, exist_ok=True)
    file_path = tmp_path / f"gpt_input_{uuid.uuid4().hex[:8]}.txt"
    file_path.write_text(text, encoding="utf-8")
    instruction = (
        f"입력이 길어 파일로 전달합니다. 파일 {file_path}를 읽고 그 내용을 검토 대상으로 삼아 답하라."
    )
    return instruction, file_path
