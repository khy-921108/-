"""End-to-end: drive server.py as a real MCP client would, over stdio JSON-RPC.

Skipped when the `mcp` package isn't importable in this interpreter -
core/tools tests above don't need it, only this one does.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

pytest.importorskip("mcp")

REPO_ROOT = Path(__file__).resolve().parents[1]


class _Client:
    def __init__(self, config_path: Path):
        env = dict(os.environ)
        env["CODEX_BRIDGE_CONFIG"] = str(config_path)
        self.proc = subprocess.Popen(
            [sys.executable, "server.py"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=str(REPO_ROOT), env=env,
        )
        self._id = 0
        self._send({"jsonrpc": "2.0", "id": self._next_id(), "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "0.1"},
        }})
        self._recv()
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def _send(self, obj: dict) -> None:
        self.proc.stdin.write(json.dumps(obj) + "\n")
        self.proc.stdin.flush()

    def _recv(self) -> dict:
        line = self.proc.stdout.readline()
        return json.loads(line)

    def list_tools(self) -> list[str]:
        self._send({"jsonrpc": "2.0", "id": self._next_id(), "method": "tools/list", "params": {}})
        return [t["name"] for t in self._recv()["result"]["tools"]]

    def call(self, name: str, arguments: dict) -> str:
        self._send({
            "jsonrpc": "2.0", "id": self._next_id(), "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        })
        result = self._recv()["result"]
        return result["content"][0]["text"]

    def close(self) -> None:
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


@pytest.fixture
def client(tmp_path, bridge_config):
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(bridge_config), encoding="utf-8")
    c = _Client(config_path)
    yield c
    c.close()


def test_tools_are_all_registered(client):
    names = set(client.list_tools())
    assert names == {
        "gpt_ask", "gpt_review", "gpt_cross_check", "gpt_debate", "gpt_status", "gpt_session",
    }


def test_gpt_ask_round_trip_over_stdio(client):
    text = client.call("gpt_ask", {"question": "hello via mcp"})
    assert "[GPT 의견" in text
    assert "echo:" in text


def test_gpt_status_over_stdio(client):
    text = client.call("gpt_status", {})
    assert "0.153.4" in text


@pytest.fixture
def broken_client(tmp_path):
    config_path = tmp_path / "missing.json"  # never written
    c = _Client(config_path)
    yield c
    c.close()


def test_missing_config_reports_same_fatal_on_every_tool(broken_client):
    a = broken_client.call("gpt_status", {})
    b = broken_client.call("gpt_ask", {"question": "hi"})
    assert "[치명적 · 등급4]" in a
    assert "[치명적 · 등급4]" in b
    assert a == b
