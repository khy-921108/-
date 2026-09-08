from __future__ import annotations

from core.errors import BridgeError
from tools._common import BridgeContext, format_error, format_response, run_pipeline


def gpt_cross_check(
    ctx: BridgeContext,
    question: str,
    claude_answer: str,
    checklist: list[str] | None = None,
    cwd: str | None = None,
) -> str:
    user_input = (
        f"질문: {question}\n\n[Claude의 답 · 한쪽 의견, 정답으로 가정하지 말 것]\n{claude_answer}"
    )
    try:
        outcome = run_pipeline(
            ctx, tool_name="gpt_cross_check", role_key="cross_check", user_input=user_input,
            checklist=checklist, cwd=cwd, session_id=None, schema_name="cross_check",
        )
    except BridgeError as err:
        return format_error(err)
    return format_response(outcome)
