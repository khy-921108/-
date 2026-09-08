from __future__ import annotations

from core.errors import BridgeError, Halt
from tools._common import BridgeContext, format_error, format_response, run_pipeline

_KIND_LABEL = {"code": "코드", "design": "설계", "doc": "문서"}


def gpt_review(
    ctx: BridgeContext,
    content: str = "",
    paths: list[str] | None = None,
    kind: str = "code",
    cwd: str | None = None,
    focus: str = "",
) -> str:
    paths = paths or []
    if not content and not paths:
        return format_error(Halt("content 또는 paths 중 하나는 필요합니다", "리뷰할 내용을 전달하세요."))
    if kind not in _KIND_LABEL:
        return format_error(Halt(f"알 수 없는 kind: {kind}", "code, design, doc 중 하나를 쓰세요."))

    label = _KIND_LABEL[kind]
    if paths:
        file_list = "\n".join(f"- {p}" for p in paths)
        user_input = f"[{label} 리뷰] cwd 기준 아래 파일을 읽고 검토하라:\n{file_list}"
        if not cwd:
            return format_error(Halt("paths를 쓰려면 cwd가 필요합니다", "cwd를 함께 전달하세요."))
    else:
        user_input = f"[{label} 리뷰 대상]\n{content}"
    if focus:
        user_input += f"\n\n[중점 사항] {focus}"

    try:
        outcome = run_pipeline(
            ctx, tool_name="gpt_review", role_key="review", user_input=user_input,
            cwd=cwd, session_id=None, schema_name="review",
        )
    except BridgeError as err:
        return format_error(err)
    return format_response(outcome)
