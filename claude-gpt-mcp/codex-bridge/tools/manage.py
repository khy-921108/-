from __future__ import annotations

from core import codex_runner
from core.errors import BridgeError, Halt
from tools._common import BridgeContext, format_error


def gpt_status(ctx: BridgeContext) -> str:
    pf = ctx.preflight.check(force=True)
    lines = [
        "[codex-bridge 상태]",
        f"codex 버전: {pf.codex_version or '알 수 없음'}",
        f"로그인 상태: {'로그인됨' if pf.logged_in else '미로그인'}",
        f"sandbox: {ctx.config['codex']['sandbox']} · timeout: {ctx.config['codex']['timeout_sec']}s",
        f"allowed_roots: {ctx.config['limits']['allowed_roots'] or '(없음 — cwd 지정 불가)'}",
        f"max_debate_rounds: {ctx.config['limits']['max_debate_rounds']}",
    ]
    if pf.issues:
        lines.append(f"issues: {'; '.join(pf.issues)}")
    if pf.warnings:
        lines.append(f"warnings: {'; '.join(pf.warnings)}")
    sessions = ctx.sessions.list_sessions()
    lines.append(f"활성 세션: {len(sessions)}개")
    lines.append("정확한 잔여 사용 한도는 Codex의 /usage 명령으로 확인하세요 (여기서는 계산하지 않습니다).")
    return "\n".join(lines)


def gpt_session(ctx: BridgeContext, action: str, session_id: str | None = None) -> str:
    try:
        if action == "list":
            rows = ctx.sessions.list_sessions()
            if not rows:
                return "세션 없음"
            lines = [
                f"{r['id']} | {r['tool']} | thread={r['thread_id']} | round={r['round']} | last={r['last']}"
                for r in rows
            ]
            return "\n".join(lines)

        if action == "get":
            if not session_id:
                raise Halt("session_id 필요", "action=get 에는 session_id를 전달하세요.")
            s = ctx.sessions.load(session_id)
            return (
                f"id={s.id} tool={s.tool} thread_id={s.thread_id} round={s.round} "
                f"cwd={s.cwd} created={s.created} last={s.last} calls={len(s.calls)}건"
            )

        if action == "delete":
            if not session_id:
                raise Halt("session_id 필요", "action=delete 에는 session_id를 전달하세요.")
            thread_id = ctx.sessions.delete(session_id)
            note = ""
            if thread_id:
                ok = codex_runner.delete_thread(ctx.config["codex"]["command"], thread_id)
                note = "" if ok else f" (경고: Codex 세션 {thread_id} 삭제 실패 — Codex 쪽에 남아있을 수 있음)"
            return f"삭제됨: {session_id}{note}"

        raise Halt(f"알 수 없는 action: {action}", "list, get, delete 중 하나를 쓰세요.")
    except BridgeError as err:
        return format_error(err)
