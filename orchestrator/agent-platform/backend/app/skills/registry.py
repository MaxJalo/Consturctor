"""Каталог skills стенда."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

_SAFE_SKILL_ID = re.compile(r"[^a-zA-Z0-9_-]+")


class SkillSpec(BaseModel):
    id: str
    title: str
    description: str = ""
    source: Literal["builtin", "user", "project"] = "builtin"
    path: str = ""
    keywords: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    content: str = ""

    def public(self) -> dict[str, object]:
        return self.model_dump(exclude={"content"})


_SKILLS: list[SkillSpec] = []


def clear_skills() -> None:
    _SKILLS.clear()


def register_skill(spec: SkillSpec) -> None:
    if any(item.id == spec.id for item in _SKILLS):
        raise ValueError(f"skill already registered: {spec.id}")
    _SKILLS.append(spec)


def list_skills() -> list[SkillSpec]:
    return list(_SKILLS)


def get_skill(skill_id: str) -> SkillSpec | None:
    wanted = skill_id.strip().lower()
    return next((item for item in _SKILLS if item.id.lower() == wanted), None)


def materialize_skills(workspace: Path, skill_ids: list[str] | None = None) -> list[str]:
    """Синхронизировать выбранные (или все встроенные) скиллы в .cursor/skills рабочей папки."""
    if not _SKILLS:
        load_catalog()
    selected = {item.strip().lower() for item in skill_ids if item.strip()} if skill_ids else None
    skills_dir = workspace / ".cursor" / "skills"
    written: list[str] = []
    for spec in _SKILLS:
        if selected is not None and spec.id.lower() not in selected:
            continue
        if selected is None and spec.source != "builtin":
            continue
        if not spec.content.strip():
            continue
        safe_id = _SAFE_SKILL_ID.sub("-", spec.id).strip("-") or "skill"
        target_dir = skills_dir / safe_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / "SKILL.md"
        if not target.is_file() or target.read_text(encoding="utf-8", errors="replace") != spec.content:
            target.write_text(spec.content, encoding="utf-8")
        written.append(spec.id)
    return written


def load_catalog() -> None:
    from app.skills.catalog import load

    load()
