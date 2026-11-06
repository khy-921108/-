from __future__ import annotations

from core.errors import BridgeError
from tools._common import BridgeContext, format_error, format_response, run_pipeline


def gpt_ask(
    ctx: BridgeContext,
    question: str,
    context: str = "",
    cwd: str | None = None,
    session_id: str | None = None,
    model: str | None = None,
) -> str:
    user_input = f"{context}\n\n질문: {question}" if context else question
    try:
        outcome = run_pipeline(
            ctx, tool_name="gpt_ask", role_key="ask", user_input=user_input,
            cwd=cwd, session_id=session_id, model=model,
        )
    except BridgeError as err:
        return format_error(err)
    return format_response(outcome)
