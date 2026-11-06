import json
from pathlib import Path

import pytest

from core.config import load_config
from core.errors import Fatal


def test_missing_config_is_fatal(tmp_path: Path):
    with pytest.raises(Fatal, match="없음"):
        load_config(tmp_path / "nope.json")


def test_malformed_json_is_fatal(tmp_path: Path):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    with pytest.raises(Fatal, match="파싱 실패"):
        load_config(p)


def test_missing_required_field_is_fatal(tmp_path: Path, bridge_config: dict):
    del bridge_config["limits"]["allowed_roots"]
    p = tmp_path / "cfg.json"
    p.write_text(json.dumps(bridge_config), encoding="utf-8")
    with pytest.raises(Fatal, match="allowed_roots"):
        load_config(p)


def test_non_readonly_sandbox_warns_not_fails(tmp_path: Path, bridge_config: dict):
    bridge_config["codex"]["sandbox"] = "workspace-write"
    p = tmp_path / "cfg.json"
    p.write_text(json.dumps(bridge_config), encoding="utf-8")
    data = load_config(p)
    assert any("read-only" in w for w in data.get("_warnings", []))


def test_valid_config_loads(tmp_path: Path, bridge_config: dict):
    p = tmp_path / "cfg.json"
    p.write_text(json.dumps(bridge_config), encoding="utf-8")
    data = load_config(p)
    assert data["codex"]["sandbox"] == "read-only"
