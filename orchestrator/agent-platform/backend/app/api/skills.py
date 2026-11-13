from fastapi import APIRouter, HTTPException

from app.skills.registry import get_skill, list_skills

router = APIRouter()


@router.get("/skills")
def get_skills() -> dict[str, object]:
    return {"items": [item.public() for item in list_skills()]}


@router.get("/skills/{skill_id}")
def get_skill_detail(skill_id: str) -> dict[str, object]:
    spec = get_skill(skill_id)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"skill not found: {skill_id}")
    return spec.model_dump()
