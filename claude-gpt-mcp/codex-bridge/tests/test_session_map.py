import threading
import time

from core.errors import Halt
from core.session_map import SessionMap
import pytest


def test_create_load_roundtrip(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=2)
    s = sm.create("gpt_ask", cwd=None)
    sm.bind(s, "th-1")
    sm.bump_round(s)
    sm.record_call(s, "req1", 1.5, grade=0)
    sm.save(s)

    loaded = sm.load(s.id)
    assert loaded.thread_id == "th-1"
    assert loaded.round == 1
    assert len(loaded.calls) == 1


def test_bind_does_not_overwrite_existing_thread(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=2)
    s = sm.create("gpt_ask", cwd=None)
    sm.bind(s, "th-1")
    sm.bind(s, "th-2")  # should be a no-op
    assert s.thread_id == "th-1"


def test_load_missing_session_raises_halt(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=2)
    with pytest.raises(Halt, match="세션 없음"):
        sm.load("does-not-exist")


def test_save_survives_process_restart_reads_from_disk(tmp_path):
    sm1 = SessionMap(tmp_path, lock_timeout_sec=2)
    s = sm1.create("gpt_debate", cwd=None)
    sm1.bind(s, "th-x")
    sm1.save(s)

    sm2 = SessionMap(tmp_path, lock_timeout_sec=2)  # simulates a new process
    loaded = sm2.load(s.id)
    assert loaded.thread_id == "th-x"


def test_delete_removes_and_returns_thread_id(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=2)
    s = sm.create("gpt_ask", cwd=None)
    sm.bind(s, "th-1")
    sm.save(s)

    tid = sm.delete(s.id)
    assert tid == "th-1"
    with pytest.raises(Halt):
        sm.load(s.id)


def test_delete_missing_session_returns_none(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=2)
    assert sm.delete("nope") is None


def test_list_sessions_reflects_saved_state(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=2)
    s1 = sm.create("gpt_ask", cwd=None)
    sm.save(s1)
    s2 = sm.create("gpt_review", cwd=None)
    sm.save(s2)
    rows = {r["id"]: r for r in sm.list_sessions()}
    assert set(rows) == {s1.id, s2.id}
    assert rows[s1.id]["tool"] == "gpt_ask"


def test_purge_removes_old_sessions_only(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=2)
    old = sm.create("gpt_ask", cwd=None)
    old.last = "2000-01-01T00:00:00+00:00"
    sm.save(old)
    fresh = sm.create("gpt_ask", cwd=None)
    sm.save(fresh)  # last defaults to "now"

    removed = sm.purge(retention_days=30)
    assert [r[0] for r in removed] == [old.id]
    remaining_ids = {r["id"] for r in sm.list_sessions()}
    assert remaining_ids == {fresh.id}


def test_concurrent_calls_on_same_session_are_serialized(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=1)
    s = sm.create("gpt_debate", cwd=None)
    sm.save(s)

    def hold():
        with sm.lock(s.id, timeout=1):
            time.sleep(0.6)

    t = threading.Thread(target=hold)
    t.start()
    time.sleep(0.1)
    with pytest.raises(Halt, match="세션 잠금"):
        with sm.lock(s.id, timeout=0.2):
            pass
    t.join()


def test_different_sessions_run_in_parallel(tmp_path):
    sm = SessionMap(tmp_path, lock_timeout_sec=1)
    s1 = sm.create("gpt_ask", cwd=None)
    s2 = sm.create("gpt_ask", cwd=None)
    sm.save(s1)
    sm.save(s2)

    acquired = []

    def hold(sid):
        with sm.lock(sid, timeout=1):
            acquired.append(sid)
            time.sleep(0.3)

    t1 = threading.Thread(target=hold, args=(s1.id,))
    t2 = threading.Thread(target=hold, args=(s2.id,))
    start = time.monotonic()
    t1.start(); t2.start()
    t1.join(); t2.join()
    elapsed = time.monotonic() - start
    assert set(acquired) == {s1.id, s2.id}
    assert elapsed < 0.55  # ran concurrently, not serialized (~0.3s each)
