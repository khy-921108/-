from __future__ import annotations

from core.errors import BridgeError
from tools._common import BridgeContext, format_error, format_response, run_pipeline


def gpt_debate(
    ctx: BridgeContext,
    topic: str,
    claude_position: str,
    session_id: str | None = None,
) -> str:
    if session_id:
        user_input = f"[다음 발언] Claude 입장: {claude_position}"
    else:
        user_input = f"주제: {topic}\n\nClaude 입장: {claude_position}"
    try:
        outcome = run_pipeline(
            ctx, tool_name="gpt_debate", role_key="debate", user_input=user_input,
            cwd=None, session_id=session_id, schema_name="debate", is_debate=True,
        )
    except BridgeError as err:
        return format_error(err)
    return format_response(outcome)
