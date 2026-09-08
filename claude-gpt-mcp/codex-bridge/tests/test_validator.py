import pytest

from core.errors import Fatal, Halt
from core.validator import (
    Preflight,
    check_cwd,
    check_events,
    check_input,
    check_response,
    check_session_round,
    classify_failure,
    require_ok,
)


def test_preflight_ok_with_fake_codex(bridge_config):
    pf = Preflight(bridge_config)
    result = pf.check()
    assert result.ok
    assert result.logged_in
    assert "0.153.4" in result.codex_version
    require_ok(pf)  # should not raise


def test_preflight_caches_within_window(bridge_config):
    bridge_config["preflight"]["cache_sec"] = 999
    pf = Preflight(bridge_config)
    first = pf.check()
    second = pf.check()
    assert first is second  # cached, not re-run


def test_preflight_force_bypasses_cache(bridge_config):
    pf = Preflight(bridge_config)
    first = pf.check()
    second = pf.check(force=True)
    assert first is not second


def test_preflight_fatal_when_codex_missing(bridge_config):
    bridge_config["codex"]["command"] = "/no/such/codex/binary"
    pf = Preflight(bridge_config)
    with pytest.raises(Fatal, match="찾을 수 없음"):
        require_ok(pf)


def test_check_input_within_limit_passes():
    check_input("short", max_chars=100)  # no raise


def test_check_input_over_limit_raises():
    with pytest.raises(Halt, match="입력 길이 초과"):
        check_input("x" * 10, max_chars=5)


def test_check_cwd_none_returns_none():
    assert check_cwd(None, ["/tmp"]) is None


def test_check_cwd_empty_allowed_roots_raises(tmp_path):
    with pytest.raises(Halt, match="allowed_roots"):
        check_cwd(str(tmp_path), [])


def test_check_cwd_inside_allowed_root_passes(tmp_path):
    sub = tmp_path / "project"
    sub.mkdir()
    assert check_cwd(str(sub), [str(tmp_path)]) == str(sub)


def test_check_cwd_outside_allowed_root_raises(tmp_path):
    with pytest.raises(Halt, match="허용 폴더 밖"):
        check_cwd("/etc", [str(tmp_path)])


def test_check_session_round_under_limit_passes():
    check_session_round(3, max_rounds=5)  # no raise


def test_check_session_round_over_limit_raises():
    with pytest.raises(Halt, match="라운드 상한"):
        check_session_round(6, max_rounds=5)


def test_check_events_well_formed_returns_thread_id():
    tid = check_events([{"type": "thread.started", "thread_id": "abc"}])
    assert tid == "abc"


def test_check_events_missing_thread_started_raises():
    with pytest.raises(Halt, match="thread.started"):
        check_events([{"type": "turn.started"}])


def test_check_events_empty_raises():
    with pytest.raises(Halt):
        check_events([])


def test_check_response_none_parsed_warns():
    warnings = check_response(None, ["summary"])
    assert warnings and "구조화 실패" in warnings[0]


def test_check_response_missing_keys_warns():
    warnings = check_response({"summary": "x"}, ["summary", "findings"])
    assert warnings and "findings" in warnings[0]


def test_check_response_complete_has_no_warnings():
    assert check_response({"summary": "x", "findings": []}, ["summary", "findings"]) == []


def test_classify_failure_auth_is_fatal():
    err = classify_failure(1, limit_hit=False, auth_error=True, timed_out=False)
    assert err.grade == 4


def test_classify_failure_limit_is_halt():
    err = classify_failure(1, limit_hit=True, auth_error=False, timed_out=False)
    assert err.grade == 3
    assert "한도" in err.message


def test_classify_failure_timeout_is_halt():
    err = classify_failure(-9, limit_hit=False, auth_error=False, timed_out=True)
    assert err.grade == 3
    assert "타임아웃" in err.message


def test_classify_failure_generic_exit_is_halt():
    err = classify_failure(7, limit_hit=False, auth_error=False, timed_out=False)
    assert err.grade == 3
    assert "7" in err.message
