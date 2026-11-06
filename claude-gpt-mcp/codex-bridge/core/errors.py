"""Graded exceptions shared by every core module and tool.

Grades follow docs/DESIGN.md §8:
  1 AutoHandled - not raised, caller falls back silently and logs
  2 Warn        - not raised, caller appends to result warnings
  3 Halt        - stop this call only, explain cause + fix
  4 Fatal       - stop every tool the same way until fixed
"""
from __future__ import annotations


class BridgeError(Exception):
    """Base for all graded errors. `action` is the one-line fix shown to Claude."""

    grade: int = 3

    def __init__(self, message: str, action: str = ""):
        super().__init__(message)
        self.message = message
        self.action = action

    def render(self) -> str:
        label = {1: "자동처리", 2: "경고", 3: "중단", 4: "치명적"}[self.grade]
        text = f"[{label} · 등급{self.grade}] {self.message}"
        if self.action:
            text += f"\n조치: {self.action}"
        return text


class Halt(BridgeError):
    grade = 3


class Fatal(BridgeError):
    grade = 4
