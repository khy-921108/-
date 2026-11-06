from pathlib import Path

from core.logger import BridgeLogger, CallRecord, mask


def test_mask_redacts_secrets_and_pii():
    text = "key sk-abcdefghijklmno phone 010-1234-5678 email a@b.com"
    masked = mask(text)
    assert "sk-abcdefghijklmno" not in masked
    assert "010-1234-5678" not in masked
    assert "a@b.com" not in masked
    assert masked.count("***") == 3


def test_call_writes_to_daily_file_and_masks(tmp_path: Path):
    logger = BridgeLogger(tmp_path, log_bodies=False)
    logger.call(CallRecord(request_id="r1", tool="gpt_ask", message="token sk-abcdefghij1234"))

    files = list(tmp_path.glob("*.log"))
    assert len(files) == 1
    content = files[0].read_text(encoding="utf-8")
    assert "request_id=r1" in content
    assert "tool=gpt_ask" in content
    assert "sk-abcdefghij1234" not in content


def test_body_only_logged_when_enabled(tmp_path: Path):
    off = BridgeLogger(tmp_path / "off", log_bodies=False)
    off.body("r1", "prompt", "secret text")
    off_files = list((tmp_path / "off").glob("*.log"))
    assert not off_files or "secret" not in off_files[0].read_text(encoding="utf-8")

    on = BridgeLogger(tmp_path / "on", log_bodies=True)
    on.body("r1", "prompt", "hello world")
    on_files = list((tmp_path / "on").glob("*.log"))
    assert on_files and "hello world" in on_files[0].read_text(encoding="utf-8")
