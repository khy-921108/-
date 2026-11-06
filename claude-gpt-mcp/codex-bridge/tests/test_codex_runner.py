import time

from core import codex_runner as cr


def test_new_conversation_returns_thread_and_message(fake_codex):
    r = cr.run(fake_codex, "hello", cwd=None, timeout_sec=10)
    assert r.thread_id == "th-fake-0001"
    assert r.last_message == "echo:hello"
    assert r.exit_code == 0
    assert not r.timed_out and not r.limit_hit and not r.auth_error


def test_resume_continues_same_thread(fake_codex):
    r = cr.run(fake_codex, "follow up", cwd=None, resume_thread="th-fake-0001", timeout_sec=10)
    assert r.last_message == "resumed:th-fake-0001:follow up"


def test_output_schema_produces_parsed_json(fake_codex):
    r = cr.run(
        fake_codex, "TRIGGER_JSON_CROSS please", cwd=None,
        schema_path="schemas/cross_check.json", timeout_sec=10,
    )
    assert r.parsed == {"verdict": "agree", "items": [], "missing_points": []}


def test_non_json_answer_with_schema_leaves_parsed_none(fake_codex):
    r = cr.run(fake_codex, "plain answer", cwd=None, schema_path="schemas/cross_check.json", timeout_sec=10)
    assert r.parsed is None
    assert r.last_message  # raw text still returned, never dropped


def test_usage_limit_is_detected(fake_codex):
    r = cr.run(fake_codex, "TRIGGER_LIMIT now", cwd=None, timeout_sec=10)
    assert r.limit_hit
    assert r.exit_code != 0


def test_auth_error_is_detected(fake_codex):
    r = cr.run(fake_codex, "TRIGGER_AUTH now", cwd=None, timeout_sec=10)
    assert r.auth_error


def test_reconnect_events_are_counted(fake_codex):
    r = cr.run(fake_codex, "TRIGGER_RECONNECT then answer", cwd=None, timeout_sec=10)
    assert r.reconnects == 1
    assert r.last_message == "echo:TRIGGER_RECONNECT then answer"


def test_generic_nonzero_exit_is_not_misclassified(fake_codex):
    r = cr.run(fake_codex, "TRIGGER_BADEXIT", cwd=None, timeout_sec=10)
    assert r.exit_code == 7
    assert not r.limit_hit and not r.auth_error


def test_timeout_kills_process_and_returns_promptly(fake_codex):
    started = time.monotonic()
    r = cr.run(fake_codex, "TRIGGER_TIMEOUT sleep", cwd=None, timeout_sec=1)
    elapsed = time.monotonic() - started
    assert r.timed_out
    assert elapsed < 3  # the fake sleeps for 5s; a working kill returns well under that


def test_delete_thread_reports_success_and_failure(fake_codex):
    assert cr.delete_thread(fake_codex, "th-anything") is True
    assert cr.delete_thread("/no/such/binary", "th-anything") is False
