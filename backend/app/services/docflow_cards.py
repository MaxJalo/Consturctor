"""Карточка пилотного документа и запись графа жизненного цикла в PostgreSQL.

Выгрузка из 1С, журналы экрана и регистрация в 1С здесь не делаются.
Карточка создаётся только для пяти пилотных видов. Остальные виды
хранят статусы и стрелки, но маршрут по ним не запускается.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.docflow_card import (
    EXTENSION_MODELS,
    DocflowClass,
    DocflowDocument,
    DocflowEdge,
    DocflowEvent,
    DocflowStatus,
)
from app.services.docflow_lifecycle import (
    CLASSES,
    TransitionDenied,
    assert_transition,
    class_by_code,
)


class DocflowCardError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _status_id(class_code: str, code: str) -> str:
    return f"{class_code}:{code}"


def seed_docflow_lifecycle(db: Session) -> int:
    """Повторный запуск обновляет подписи и стрелки и не плодит вторые строки."""
    for kind in CLASSES:
        row = db.get(DocflowClass, kind.code)
        if row is None:
            db.add(
                DocflowClass(
                    code=kind.code,
                    title=kind.title,
                    pilot=kind.pilot,
                    execution=kind.execution,
                )
            )
        else:
            row.title = kind.title
            row.pilot = kind.pilot
            row.execution = kind.execution
        for status in kind.statuses:
            status_id = _status_id(kind.code, status.code)
            current = db.get(DocflowStatus, status_id)
            if current is None:
                db.add(
                    DocflowStatus(
                        id=status_id,
                        class_code=kind.code,
                        code=status.code,
                        label=status.label,
                        sort_order=status.sort,
                        optional=status.optional,
                    )
                )
            else:
                current.label = status.label
                current.sort_order = status.sort
                current.optional = status.optional
        db.flush()
        wanted: set[str] = set()
        for edge in kind.edges:
            edge_id = f"{_status_id(kind.code, edge.src)}>{_status_id(kind.code, edge.dst)}"
            wanted.add(edge_id)
            current = db.get(DocflowEdge, edge_id)
            if current is None:
                db.add(
                    DocflowEdge(
                        id=edge_id,
                        class_code=kind.code,
                        from_status_id=_status_id(kind.code, edge.src),
                        to_status_id=_status_id(kind.code, edge.dst),
                        branch=edge.branch,
                        reason_required=edge.reason_required,
                        author_only=edge.author_only,
                    )
                )
            else:
                current.branch = edge.branch
                current.reason_required = edge.reason_required
                current.author_only = edge.author_only
        stale = db.scalars(select(DocflowEdge).where(DocflowEdge.class_code == kind.code)).all()
        for item in stale:
            if item.id not in wanted:
                db.delete(item)
    return len(CLASSES)


def create_document(
    db: Session,
    *,
    class_code: str,
    title: str,
    body: str,
    legal_entity: str,
    author_user_id: str,
    author_fio: str,
    initial_status: str = "",
) -> DocflowDocument:
    try:
        kind = class_by_code(class_code)
    except TransitionDenied as exc:
        raise DocflowCardError(exc.message, 404) from exc
    if not kind.pilot:
        raise DocflowCardError("Карточка этого вида в пилот не входит", 409)
    start = initial_status.strip() or (kind.initial[0] if len(kind.initial) == 1 else "")
    if start not in kind.initial:
        raise DocflowCardError("Для этого вида нужно указать начальный статус", 400)
    document = DocflowDocument(
        id=str(uuid.uuid4()),
        class_code=kind.code,
        status_id=_status_id(kind.code, start),
        legal_entity=legal_entity.strip(),
        title=title.strip(),
        body=body,
        author_fio=author_fio.strip(),
        author_user_id=author_user_id,
        source="local",
    )
    db.add(document)
    extension_model = EXTENSION_MODELS.get(kind.code)
    if extension_model is not None:
        db.add(extension_model(document_id=document.id))
    db.add(
        DocflowEvent(
            id=str(uuid.uuid4()),
            document_id=document.id,
            actor_user_id=author_user_id,
            actor_fio=author_fio.strip(),
            from_status="",
            to_status=start,
            reason="Карточка создана",
        )
    )
    db.flush()
    return document


def apply_transition(
    db: Session,
    *,
    document_id: str,
    to_status: str,
    reason: str,
    actor_user_id: str,
    actor_fio: str,
) -> DocflowDocument:
    document = db.get(DocflowDocument, document_id)
    if document is None:
        raise DocflowCardError("Карточка не найдена", 404)
    status = db.get(DocflowStatus, document.status_id)
    if status is None:
        raise DocflowCardError("Текущий статус карточки не найден", 409)
    try:
        assert_transition(
            document.class_code,
            status.code,
            to_status,
            actor_is_author=bool(actor_user_id) and actor_user_id == document.author_user_id,
            reason=reason,
        )
    except TransitionDenied as exc:
        raise DocflowCardError(exc.message, 409) from exc
    document.status_id = _status_id(document.class_code, to_status)
    db.add(
        DocflowEvent(
            id=str(uuid.uuid4()),
            document_id=document.id,
            actor_user_id=actor_user_id,
            actor_fio=actor_fio.strip(),
            from_status=status.code,
            to_status=to_status,
            reason=reason.strip(),
        )
    )
    db.flush()
    return document
