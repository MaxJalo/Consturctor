from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.jwt import AuthContext
from app.db.session import get_db
from app.models.docflow_card import DocflowDocument, DocflowEvent, DocflowStatus
from app.models.user import AppUser
from app.services.docflow_cards import DocflowCardError, apply_transition, create_document
from app.services.docflow_lifecycle import lifecycle_public

router = APIRouter(prefix="/docflow", tags=["docflow"])


class DocumentCreate(BaseModel):
    class_code: str = Field(..., min_length=1, max_length=32)
    title: str = Field(..., min_length=1, max_length=512)
    body: str = ""
    legal_entity: str = ""
    initial_status: str = ""


class DocumentTransition(BaseModel):
    to_status: str = Field(..., min_length=1, max_length=32)
    reason: str = ""


def _raise(exc: DocflowCardError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


def _actor(db: Session, auth: AuthContext) -> tuple[str, str]:
    user = db.get(AppUser, auth.user_id)
    fio = (user.fio if user else "") or (auth.fio or "")
    return auth.user_id, fio.strip()


def _card(db: Session, document: DocflowDocument) -> dict:
    status = db.get(DocflowStatus, document.status_id)
    events = (
        db.query(DocflowEvent)
        .filter(DocflowEvent.document_id == document.id)
        .order_by(DocflowEvent.created_at.asc())
        .all()
    )
    return {
        "id": document.id,
        "class_code": document.class_code,
        "status": status.code if status else "",
        "status_label": status.label if status else "",
        "title": document.title,
        "source": document.source,
        "onec_ref_key": document.onec_ref_key,
        "author_user_id": document.author_user_id,
        "events": [
            {
                "from": item.from_status,
                "to": item.to_status,
                "reason": item.reason,
                "actor_user_id": item.actor_user_id,
            }
            for item in events
        ],
    }


@router.get("/lifecycle")
def read_lifecycle(_: AuthContext = Depends(get_current_user)) -> dict:
    return {"classes": lifecycle_public()}


@router.post("/documents")
def post_document(
    payload: DocumentCreate,
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    user_id, fio = _actor(db, auth)
    try:
        document = create_document(
            db,
            class_code=payload.class_code.strip(),
            title=payload.title,
            body=payload.body,
            legal_entity=payload.legal_entity,
            author_user_id=user_id,
            author_fio=fio,
            initial_status=payload.initial_status,
        )
        db.commit()
    except DocflowCardError as exc:
        db.rollback()
        _raise(exc)
    db.refresh(document)
    return _card(db, document)


@router.post("/documents/{document_id}/transition")
def post_transition(
    document_id: str,
    payload: DocumentTransition,
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    user_id, fio = _actor(db, auth)
    try:
        document = apply_transition(
            db,
            document_id=document_id,
            to_status=payload.to_status.strip(),
            reason=payload.reason,
            actor_user_id=user_id,
            actor_fio=fio,
        )
        db.commit()
    except DocflowCardError as exc:
        db.rollback()
        _raise(exc)
    db.refresh(document)
    return _card(db, document)
