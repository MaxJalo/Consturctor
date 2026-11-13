"""Загрузка SKILL.md из встроенных скиллов платформы.

Личные скиллы ~/.cursor/skills в чат Оркестратора не попадают: это скиллы продукта.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Literal

from app.skills.registry import SkillSpec, clear_skills, register_skill

logger = logging.getLogger(__name__)

_BUILTIN_DIR = Path(__file__).resolve().parent / "builtin"
_FRONTMATTER_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.DOTALL)


def _parse_frontmatter(raw: str) -> dict[str, str]:
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        return {}
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        cleaned = value.strip().strip('"').strip("'")
        if key.strip():
            meta[key.strip().lower()] = cleaned
    return meta


def _parse_keywords(raw: str) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.strip("[]").split(",") if part.strip()]


def _scan_dir(root: Path, source: Literal["builtin", "user", "project"], seen: set[str]) -> None:
    if not root.is_dir():
        return
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        skill_file = folder / "SKILL.md"
        if not skill_file.is_file():
            continue
        try:
            content = skill_file.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Failed to read skill %s: %s", skill_file, exc)
            continue
        meta = _parse_frontmatter(content)
        skill_id = (meta.get("name") or folder.name).strip()
        if not skill_id or skill_id.lower() in seen:
            continue
        seen.add(skill_id.lower())
        title = (meta.get("title") or skill_id).strip()
        description = (meta.get("description") or "").strip()
        keywords = _parse_keywords(meta.get("keywords") or "")
        roles = [part.strip().lower() for part in _parse_keywords(meta.get("roles") or "")]
        register_skill(
            SkillSpec(
                id=skill_id,
                title=title,
                description=description,
                source=source,
                path=str(skill_file),
                keywords=keywords,
                roles=roles,
                content=content,
            )
        )


def load() -> None:
    clear_skills()
    seen: set[str] = set()
    _scan_dir(_BUILTIN_DIR, "builtin", seen)
