"""Общий банк умений служб внешнего заказа."""

from __future__ import annotations

import re
import uuid

from sqlalchemy.orm import Session

from app.models.agent_skill import AgentSkill

ROLES = frozenset({"ks", "development", "rp", "committee", "kb", "omto", "finance", "production", "legal", "it"})


class SkillError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _title_key(title: str) -> str:
    return re.sub(r"\s+", " ", title.strip().casefold())


def skill_markdown(row: AgentSkill) -> str:
    return (
        f"---\nname: {row.id}\ntitle: {row.title}\ndescription: {row.title}\nroles: {row.role}\n---\n\n"
        f"# {row.title}\n\n{row.body.strip()}\n"
    )


def list_skills(db: Session, role: str) -> list[AgentSkill]:
    wanted = role.strip().lower()
    if wanted not in ROLES:
        raise SkillError("Неизвестная служба")
    return (
        db.query(AgentSkill)
        .filter(AgentSkill.role == wanted)
        .order_by(AgentSkill.created_at.asc(), AgentSkill.title.asc())
        .all()
    )


def get_skill(db: Session, skill_id: str) -> AgentSkill | None:
    return db.get(AgentSkill, skill_id.strip())


def create_skill(db: Session, *, title: str, body: str, role: str, author: str) -> AgentSkill:
    clean_title = title.strip()
    clean_body = body.strip()
    wanted = role.strip().lower()
    if not clean_title:
        raise SkillError("Укажите название умения")
    if not clean_body:
        raise SkillError("Укажите текст инструкции")
    if wanted not in ROLES:
        raise SkillError("Неизвестная служба")
    key = _title_key(clean_title)
    existing = db.query(AgentSkill).filter(AgentSkill.role == wanted, AgentSkill.title_key == key).one_or_none()
    if existing is not None:
        return existing
    row = AgentSkill(
        id=f"bank-{wanted}-{uuid.uuid4().hex[:12]}",
        role=wanted,
        title=clean_title,
        title_key=key,
        body=clean_body,
        author=author.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
