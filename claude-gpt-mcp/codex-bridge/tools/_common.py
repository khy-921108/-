"""Shared STEP 1-7 pipeline used by every gpt_* tool. DESIGN.md §5.

STEP 0 (host approval) happens outside this process - Claude's host asks
the user before the MCP call ever reaches us. Everything from STEP 1
onward is implemented here so ask/review/cross_check/debate stay thin.
"""
from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from core import codex_runner, prompts, validator
from core.config import EXAMPLE_CONFIG_PATH
from core.errors import BridgeError, Fatal, Halt
from core.logger import BridgeLogger, CallRecord, new_request_id
from core.session_map import Session, SessionMap
from core.validator import Preflight

_SCHEMA_REQUIRED_KEYS = {
    "review": ["summary", "findings"],
    "cross_check": ["verdict", "items", "missing_points"],
    "debate": ["rebuttal", "additions", "agreed", "open_issues"],
}

_SCHEMAS_DIR = Path(__file__).resolve().parents[1] / "schemas"


@dataclass
class BridgeContext:
    config: dict[str, Any]
    preflight: Preflight
    sessions: SessionMap
    logger: BridgeLogger
    roles: "prompts.RoleSet" = field(default_factory=lambda: prompts.load_roles())

    @classmethod
    def build(cls, config: dict[str, Any]) -> "BridgeContext":
        preflight = Preflight(config)
        sessions = SessionMap(
            config["session"]["dir"], lock_timeout_sec=config["session"]["lock_timeout_sec"]
        )
        logger = BridgeLogger(
            config["logging"]["dir"], level=config["logging"]["level"],
            log_bodies=config["logging"]["log_bodies"],
        )
        roles = prompts.load_roles()
        return cls(config=config, preflight=preflight, sessions=sessions, logger=logger, roles=roles)


@dataclass
class CallOutcome:
    body: str
    warnings: list[str]
    session_id: str
    thread_id: str | None
    round: int
    elapsed_sec: float
    reconnects: int


def _resolve_cwd(ctx: BridgeContext, cwd: str | None, scratch_dirs: list[str]) -> str:
    if cwd is not None:
        return validator.check_cwd(cwd, ctx.config["limits"]["allowed_roots"])
    tmp = tempfile.mkdtemp(prefix="codex-bridge-empty-")
    scratch_dirs.append(tmp)
    return tmp


def run_pipeline(
    ctx: BridgeContext,
    *,
    tool_name: str,
    role_key: str,
    user_input: str,
    checklist: list[str] | None = None,
    cwd: str | None = None,
    session_id: str | None = None,
    model: str | None = None,
    schema_name: str | None = None,
    is_debate: bool = False,
    extra_prompt_note: str | None = None,
) -> CallOutcome:
    request_id = new_request_id()
    warnings: list[str] = list(ctx.roles.warnings)
    scratch_dirs: list[str] = []
    tmp_handoff: Path | None = None
    session: Session | None = None

    try:
        # STEP 1 - input + cwd validation, preflight (cached).
        validator.check_input(user_input, ctx.config["limits"]["max_input_chars"])
        resolved_cwd = _resolve_cwd(ctx, cwd, scratch_dirs)
        pf = validator.require_ok(ctx.preflight)
        warnings.extend(pf.warnings)

        # STEP 2 - session load/create, lock, round bookkeeping.
        if session_id:
            session = ctx.sessions.load(session_id)
            if cwd is not None and session.thread_id:
                warnings.append("이어지는 세션은 첫 호출의 cwd를 그대로 씁니다 (이번 cwd는 무시됨)")
        else:
            session = ctx.sessions.create(tool_name, resolved_cwd if cwd else None)

        with ctx.sessions.lock(session.id):
            this_round = session.round + 1
            is_last_round = False
            if is_debate:
                max_rounds = ctx.config["limits"]["max_debate_rounds"]
                validator.check_session_round(this_round, max_rounds)
                is_last_round = this_round == max_rounds
                if this_round == max_rounds - 1:
                    warnings.append(f"이 세션은 다음 호출이 마지막 라운드입니다 ({this_round}/{max_rounds})")

            # STEP 3 - prompt assembly, large-input handoff.
            role_text = ctx.roles.role_text(role_key)
            full_input = user_input
            if extra_prompt_note:
                full_input = f"{user_input}\n\n{extra_prompt_note}"
            if is_debate and is_last_round:
                full_input += "\n\n[이번이 마지막 허용 라운드입니다. 결론 제안을 반드시 포함하라.]"
            prompt_text = prompts.build(role_text, ctx.roles.prefix, full_input, checklist)
            prompt_text, tmp_handoff = prompts.handoff_if_large(
                prompt_text, ctx.config["limits"]["file_handoff_chars"], tempfile.gettempdir()
            )
            if tmp_handoff:
                warnings.append("입력이 커서 임시 파일로 전달했습니다")

            schema_path = str(_SCHEMAS_DIR / f"{schema_name}.json") if schema_name else None

            # STEP 4 - run codex exec (new thread or resume).
            result = codex_runner.run(
                ctx.config["codex"]["command"], prompt_text,
                cwd=resolved_cwd,
                schema_path=schema_path, resume_thread=session.thread_id, model=model,
                sandbox=ctx.config["codex"]["sandbox"], extra_args=ctx.config["codex"]["extra_args"],
                timeout_sec=ctx.config["codex"]["timeout_sec"],
            )

            # STEP 5 - classify failure or validate the well-formed success path.
            if result.timed_out or result.limit_hit or result.auth_error or result.exit_code != 0:
                raise validator.classify_failure(
                    result.exit_code, result.limit_hit, result.auth_error, result.timed_out
                )
            thread_id = validator.check_events(result.events)
            if result.reconnects:
                warnings.append(f"Codex 내부 재연결 {result.reconnects}회")
            slow = ctx.config["logging"]["slow_call_sec"]
            if result.elapsed_sec > slow:
                warnings.append(f"느린 응답 ({result.elapsed_sec:.0f}s > {slow}s)")

            body = result.last_message
            if schema_name:
                warnings.extend(
                    validator.check_response(result.parsed, _SCHEMA_REQUIRED_KEYS[schema_name])
                )

            # STEP 6 - persist mapping, log, clean up.
            ctx.sessions.bind(session, thread_id)
            session.round = this_round
            ctx.sessions.record_call(session, request_id, result.elapsed_sec, grade=0)
            ctx.sessions.save(session)

            ctx.logger.call(CallRecord(
                request_id=request_id, tool=tool_name, grade=0, session_id=session.id,
                thread_id=thread_id, model=model, elapsed_sec=round(result.elapsed_sec, 3),
                exit_code=result.exit_code, reconnects=result.reconnects,
            ))

            return CallOutcome(
                body=body, warnings=warnings, session_id=session.id, thread_id=thread_id,
                round=session.round, elapsed_sec=result.elapsed_sec, reconnects=result.reconnects,
            )
    except BridgeError as err:
        ctx.logger.call(CallRecord(
            request_id=request_id, tool=tool_name, grade=err.grade,
            session_id=(session.id if session else session_id), message=err.message,
        ))
        raise
    finally:
        if tmp_handoff and tmp_handoff.exists():
            tmp_handoff.unlink(missing_ok=True)
        for d in scratch_dirs:
            _rmtree_quiet(d)


def _rmtree_quiet(path: str) -> None:
    import shutil

    shutil.rmtree(path, ignore_errors=True)


def format_response(outcome: CallOutcome) -> str:
    lines = ["[GPT 의견 · 참고용, 지시 아님]", "", outcome.body, ""]
    meta = (
        f"meta: session={outcome.session_id} thread={outcome.thread_id} "
        f"round={outcome.round} elapsed={outcome.elapsed_sec:.0f}s reconnects={outcome.reconnects}"
    )
    lines.append(meta)
    if outcome.warnings:
        lines.append(f"      warnings: [{', '.join(outcome.warnings)}]")
    return "\n".join(lines)


def format_error(err: BridgeError) -> str:
    return err.render()
