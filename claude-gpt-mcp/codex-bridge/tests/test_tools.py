from tools.ask import gpt_ask
from tools.cross_check import gpt_cross_check
from tools.debate import gpt_debate
from tools.manage import gpt_session, gpt_status
from tools.review import gpt_review


def _session_id(response: str) -> str:
    meta = next(line for line in response.splitlines() if line.startswith("meta:"))
    return meta.split("session=")[1].split()[0]


def test_ask_new_session_then_resume(ctx):
    r1 = gpt_ask(ctx, "hello?")
    assert "[GPT 의견" in r1 and "echo:" in r1
    sid = _session_id(r1)

    r2 = gpt_ask(ctx, "again", session_id=sid)
    assert "resumed:th-fake-0001:" in r2
    assert _session_id(r2) == sid
    assert "round=2" in r2


def test_ask_unknown_session_id_returns_halt_text(ctx):
    r = gpt_ask(ctx, "hi", session_id="nope")
    assert "[중단 · 등급3]" in r
    assert "세션 없음" in r


def test_review_requires_content_or_paths(ctx):
    r = gpt_review(ctx, content="", paths=[])
    assert "[중단" in r and "content 또는 paths" in r


def test_review_rejects_unknown_kind(ctx):
    r = gpt_review(ctx, content="x", kind="bogus")
    assert "[중단" in r and "kind" in r


def test_review_paths_without_cwd_is_rejected(ctx):
    r = gpt_review(ctx, paths=["a.py"], kind="code")
    assert "[중단" in r and "cwd" in r


def test_review_schema_success(ctx):
    r = gpt_review(ctx, content="TRIGGER_JSON_REVIEW please review this", kind="code")
    assert '"summary": "ok"' in r
    assert "warnings" not in r or "스키마 필드 누락" not in r


def test_review_schema_mismatch_falls_back_to_raw_text(ctx):
    r = gpt_review(ctx, content="not json at all", kind="doc")
    assert "echo:" in r
    assert "스키마 필드 누락" in r or "구조화 실패" in r


def test_cross_check_includes_checklist_and_claude_answer_label(ctx):
    r = gpt_cross_check(ctx, "TRIGGER_JSON_CROSS is this ok?", "yes", checklist=["p1", "p2"])
    assert '"verdict": "agree"' in r


def test_cross_check_rejects_cwd_outside_allowed_roots(ctx):
    r = gpt_cross_check(ctx, "q", "a", cwd="/etc")
    assert "[중단 · 등급3]" in r
    assert "허용 폴더 밖" in r


def test_debate_rounds_and_cap(ctx):
    ctx.config["limits"]["max_debate_rounds"] = 2

    r1 = gpt_debate(ctx, "TRIGGER_JSON_DEBATE topic", "A is better")
    assert "round=1" in r1
    sid = _session_id(r1)

    r2 = gpt_debate(ctx, "", "counter", session_id=sid)
    assert "round=2" in r2
    assert "마지막 허용 라운드" in r2 or "resumed:" in r2  # prompt included the last-round note

    r3 = gpt_debate(ctx, "", "one too many", session_id=sid)
    assert "[중단 · 등급3]" in r3
    assert "라운드 상한" in r3


def test_status_reports_version_and_login(ctx):
    r = gpt_status(ctx)
    assert "0.153.4" in r
    assert "로그인됨" in r


def test_session_list_get_delete_roundtrip(ctx):
    r1 = gpt_ask(ctx, "hello")
    sid = _session_id(r1)

    listing = gpt_session(ctx, "list")
    assert sid in listing

    detail = gpt_session(ctx, "get", session_id=sid)
    assert sid in detail and "thread_id=th-fake-0001" in detail

    deletion = gpt_session(ctx, "delete", session_id=sid)
    assert "삭제됨" in deletion

    after = gpt_session(ctx, "get", session_id=sid)
    assert "세션 없음" in after


def test_session_unknown_action_is_rejected(ctx):
    r = gpt_session(ctx, "explode")
    assert "[중단" in r and "action" in r
