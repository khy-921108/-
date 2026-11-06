from pathlib import Path

from core.prompts import build, handoff_if_large, load_roles


def test_load_roles_reads_real_skill_file_without_warnings():
    roles = load_roles()  # default path -> ../skill/gpt-check/SKILL.md
    assert roles.warnings == []
    assert roles.prefix
    assert roles.ask
    assert roles.cross_check
    assert roles.review
    assert roles.debate


def test_load_roles_falls_back_when_file_missing(tmp_path: Path):
    roles = load_roles(tmp_path / "nope.md")
    assert any("없음" in w for w in roles.warnings)
    assert roles.cross_check  # fallback text still present


def test_load_roles_falls_back_when_section_missing(tmp_path: Path):
    p = tmp_path / "SKILL.md"
    p.write_text("## 역할 지시\n### 공통 접두\nprefix text\n", encoding="utf-8")
    roles = load_roles(p)
    assert roles.prefix == "prefix text"
    assert any("review" in w or "리뷰" in w for w in roles.warnings) or roles.review


def test_build_assembles_prefix_role_checklist_and_input():
    text = build("ROLE", "PREFIX", "USER INPUT", checklist=["a", "b"])
    assert text.index("PREFIX") < text.index("ROLE") < text.index("1. a") < text.index("USER INPUT")


def test_build_without_checklist_omits_checklist_block():
    text = build("ROLE", "PREFIX", "USER INPUT")
    assert "체크리스트" not in text


def test_handoff_under_limit_returns_original_text(tmp_path: Path):
    text, path = handoff_if_large("short", limit=100, tmp_dir=tmp_path)
    assert text == "short"
    assert path is None


def test_handoff_over_limit_writes_file_and_returns_instruction(tmp_path: Path):
    long_text = "y" * 500
    text, path = handoff_if_large(long_text, limit=100, tmp_dir=tmp_path)
    assert path is not None and path.exists()
    assert path.read_text(encoding="utf-8") == long_text
    assert str(path) in text
