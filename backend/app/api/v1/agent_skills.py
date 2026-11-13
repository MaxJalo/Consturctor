from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.jwt import AuthContext
from app.db.session import get_db
from app.services.agent_skills import SkillError, create_skill, get_skill, list_skills, skill_markdown

router = APIRouter(prefix="/agent-skills", tags=["agent-skills"])


class SkillCreate(BaseModel):
    title: str = ""
    instruction: str = ""
    role: str = ""


def _public(row) -> dict[str, str]:
    return {"id": row.id, "title": row.title, "role": row.role, "description": row.title}


@router.get("")
def get_agent_skills(role: str = "", db: Session = Depends(get_db), auth: AuthContext = Depends(get_current_user)) -> dict:
    del auth
    try:
        rows = list_skills(db, role)
    except SkillError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {"items": [_public(row) for row in rows]}


@router.get("/{skill_id}")
def get_agent_skill(skill_id: str, db: Session = Depends(get_db), auth: AuthContext = Depends(get_current_user)) -> dict:
    del auth
    row = get_skill(db, skill_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Умение не найдено")
    return {**_public(row), "content": skill_markdown(row)}


@router.post("")
def post_agent_skill(
    body: SkillCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
) -> dict:
    try:
        row = create_skill(
            db,
            title=body.title,
            body=body.instruction,
            role=body.role,
            author=auth.fio or auth.user_id,
        )
    except SkillError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return _public(row)
