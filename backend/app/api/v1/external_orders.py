from __future__ import annotations

import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.jwt import AuthContext
from app.db.session import SessionLocal, get_db, pool_is_saturated
from app.services.external_orders import (
    ExternalOrderError,
    accept_finding,
    accept_plan,
    accept_role_findings,
    add_baseline,
    add_decision,
    add_document,
    add_risk,
    approve_order_file,
    close_conditions,
    close_diff,
    close_gap,
    confirm_check,
    create_order,
    register_request,
    delete_order_file,
    edit_order_file,
    get_order,
    import_onec_order,
    import_tkp_order,
    link_onec,
    link_order_file,
    make_plan,
    meta_for,
    patch_order,
    publish_order_plan,
    recent_onec_orders,
    refresh_onec,
    correct_finding,
    reject_finding,
    run_copilot,
    save_order_text,
    search_onec,
    transition,
    unlink_order_file,
    upload_order_file,
)

router = APIRouter(prefix="/external-orders", tags=["external-orders"])


class OrderLineIn(BaseModel):
    name: str = ""
    qty: str = ""
    amount: str = ""


class OrderCreateIn(BaseModel):
    customer: str = ""
    product: str = ""
    inn: str = ""
    contact: str = ""
    order_type: str = ""
    priority: str = ""
    lines: list[OrderLineIn] = Field(default_factory=list)
    terms: dict[str, str] = Field(default_factory=dict)


class RegisterFileIn(BaseModel):
    kind: str = ""
    filename: str = ""
    content_base64: str = ""


class RegisterRequestIn(BaseModel):
    files: list[RegisterFileIn] = Field(default_factory=list)


class OrderPatchIn(BaseModel):
    sections: dict = Field(default_factory=dict)
    owners: dict = Field(default_factory=dict)
    route: str | None = None


class TransitionIn(BaseModel):
    target: str


class EvidenceIn(BaseModel):
    evidence: str = ""


class DiffCloseIn(BaseModel):
    note: str = ""


class RiskIn(BaseModel):
    title: str = ""
    impact: str = ""
    measure: str = ""
    source: str = ""


class DecisionIn(BaseModel):
    protocol: str = ""
    decision: str = ""
    allowed_stage: str = "tkp"
    conditions: str = ""
    base_version: str = ""
    baseline_id: str = ""


class DocumentIn(BaseModel):
    kind: str = "other"
    title: str = ""
    version: str = ""
    note: str = ""


class FileIn(BaseModel):
    kind: str = "other"
    filename: str = ""
    content_base64: str = ""


class FileLinkIn(BaseModel):
    target: str = ""
    relation: str = "attachment"


class FileEditIn(BaseModel):
    kind: str = ""
    title: str = ""


class FileTextIn(BaseModel):
    kind: str = "correspondence"
    title: str = ""
    text: str = ""
    target: str = ""
    relation: str = "attachment"


class PlanIn(BaseModel):
    overrides: dict = Field(default_factory=dict)
    start: str = ""


class PlanTemplateIn(BaseModel):
    tasks: list[dict] = Field(default_factory=list)


class BaselineIn(BaseModel):
    composition: str = ""
    cost: str = ""
    mcr: str = ""
    margin: str = ""
    bdds: str = ""
    deadlines: str = ""
    reason: str = ""


class ConditionCloseIn(BaseModel):
    document_id: str = ""


class OnecLinkIn(BaseModel):
    ref_key: str = ""


class CopilotIn(BaseModel):
    step_id: str = ""
    message: str = ""
    answers: dict[str, str] = Field(default_factory=dict)
    auto_prepare: bool = True
    use_ai: bool = False


def _people(auth: AuthContext, db: Session) -> tuple[str, str, str]:
    from app.models.user import AppUser
    from app.services.external_orders import testing_profile

    user = db.get(AppUser, auth.user_id)
    return testing_profile(
        fio=auth.fio or "",
        position=auth.position or "",
        department=auth.department or "",
        stored_fio=(user.fio if user else "") or "",
        stored_position=(user.position if user else "") or "",
        stored_department=(user.department if user else "") or "",
    )


def _role(auth: AuthContext, as_role: str, db: Session) -> str:
    from app.services.external_orders import resolve_role

    fio, position, department = _people(auth, db)
    return resolve_role(fio=fio, position=position, department=department, as_role=as_role)


def _call(action):
    try:
        return action()
    except ExternalOrderError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


@router.get("/meta")
def get_meta(
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    fio, position, department = _people(auth, db)
    return meta_for(fio=fio, position=position, department=department, as_role=as_role)


@router.get("")
def get_orders(auth: AuthContext = Depends(get_current_user)) -> dict:
    _ = auth
    from app.services.external_orders import order_briefs

    items = _call(order_briefs)
    return {"count": len(items), "orders": items}


@router.post("/register")
def post_register(
    body: RegisterRequestIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: register_request(
            db,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            files=[item.model_dump() for item in body.files],
        )
    )


@router.post("")
def post_order(
    body: OrderCreateIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: create_order(
            db,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            fields=body.model_dump(),
        )
    )


@router.get("/agent")
def get_agent(
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _ = auth
    from app.services.external_order_agent import TITLE, ensure_agent

    row = ensure_agent(db)
    if row is None:
        return {"workflow_id": "", "title": TITLE}
    return {"workflow_id": row.id, "title": row.title}


@router.get("/purchase-agent")
def get_purchase_agent(
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _ = auth
    from app.services.external_purchase_agent import TITLE, ensure_agent

    row = ensure_agent(db)
    if row is None:
        return {"workflow_id": "", "title": TITLE}
    return {"workflow_id": row.id, "title": row.title}


_agents_cache: tuple[float, dict] | None = None
_agents_lock = threading.Lock()
_AGENTS_FRESH = 60.0
_AGENTS_STALE = 180.0


def _service_agent_catalog(db: Session) -> dict:
    from app.services.external_service_agents import ensure_agents, is_active, service_roles, title_for

    rows = {row.title: row for row in ensure_agents(db)}
    agents = []
    for role in service_roles():
        row = rows.get(title_for(role))
        agents.append(
            {
                "role": role,
                "workflow_id": row.id if row is not None else "",
                "title": row.title if row is not None else title_for(role),
                "active": bool(row is not None and is_active(row)),
            }
        )
    return {"agents": agents}


@router.get("/service-agents")
def get_service_agents(auth: AuthContext = Depends(get_current_user)) -> dict:
    """Каталог служб. Повтор и занятый пул не переписывают агентов и не ждут соединение."""
    _ = auth
    global _agents_cache
    now = time.monotonic()
    cached = _agents_cache
    if cached is not None and now - cached[0] < _AGENTS_FRESH:
        return cached[1]
    if cached is not None and pool_is_saturated() and now - cached[0] < _AGENTS_STALE:
        return cached[1]
    with _agents_lock:
        cached = _agents_cache
        now = time.monotonic()
        if cached is not None and now - cached[0] < _AGENTS_FRESH:
            return cached[1]
        if cached is not None and pool_is_saturated() and now - cached[0] < _AGENTS_STALE:
            return cached[1]
        db = SessionLocal()
        try:
            body = _service_agent_catalog(db)
        finally:
            db.close()
        _agents_cache = (time.monotonic(), body)
        return body


@router.get("/matrix")
def get_matrix(
    order_id: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _ = auth
    from app.services.external_order_matrix import evaluate_matrix

    def load() -> dict:
        order = get_order(db, order_id) if order_id.strip() else None
        return evaluate_matrix(order)

    return _call(load)


@router.get("/onec/recent")
def get_onec_recent(
    skip: int = Query(default=0, ge=0),
    top: int = Query(default=50, ge=1, le=500),
    q: str = Query(default=""),
    status: str = Query(default=""),
    manager: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    has_order: str = Query(default=""),
    source: str = Query(default="tkp"),
    refresh: bool = Query(default=False),
    auth: AuthContext = Depends(get_current_user),
) -> dict:
    _ = auth
    filters = {
        "q": q,
        "status": status,
        "manager": manager,
        "date_from": date_from,
        "date_to": date_to,
        "has_order": has_order,
    }
    kind = "orders" if source == "orders" else "tkp"
    return _call(lambda: recent_onec_orders(skip=skip, top=top, filters=filters, refresh=refresh, source=kind))


@router.post("/onec/import-tkp")
def post_onec_import_tkp(
    body: OnecLinkIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: import_tkp_order(
            db,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            ref_key=body.ref_key,
        )
    )


@router.post("/onec/import")
def post_onec_import(
    body: OnecLinkIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: import_onec_order(
            db,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            ref_key=body.ref_key,
        )
    )


@router.get("/onec")
def get_onec(
    q: str = Query(default=""),
    counterparty: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
) -> dict:
    _ = auth
    return _call(lambda: search_onec(q, counterparty))


@router.post("/{order_id}/strategy")
def post_strategy(
    order_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from app.services.external_order_strategy import link_strategy

    return _call(
        lambda: link_strategy(db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "")
    )


@router.get("/{order_id}/review")
def get_review(
    order_id: str,
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _ = auth
    from app.services.external_order_matrix import review_checklist

    return _call(lambda: review_checklist(get_order(db, order_id)))


_detail_cache: dict[str, tuple[float, dict]] = {}
_DETAIL_STALE = 30.0


@router.get("/{order_id}")
def get_one(order_id: str, auth: AuthContext = Depends(get_current_user)) -> dict:
    """Карточка. Если пул занят, отдаётся последняя копия не старше полминуты."""
    _ = auth
    now = time.monotonic()
    cached = _detail_cache.get(order_id)
    if cached is not None and pool_is_saturated() and now - cached[0] < _DETAIL_STALE:
        return cached[1]
    db = SessionLocal()
    try:
        body = get_order(db, order_id)
    except ExternalOrderError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
    finally:
        db.close()
    if len(_detail_cache) > 40:
        oldest = min(_detail_cache, key=lambda key: _detail_cache[key][0])
        _detail_cache.pop(oldest, None)
    _detail_cache[order_id] = (time.monotonic(), body)
    return body


@router.patch("/{order_id}")
def patch_one(
    order_id: str,
    body: OrderPatchIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    fields = body.model_dump(exclude_none=True)
    return _call(
        lambda: patch_order(db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "", fields=fields)
    )


@router.post("/{order_id}/transition")
def post_transition(
    order_id: str,
    body: TransitionIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: transition(
            db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "", target=body.target
        )
    )


@router.post("/{order_id}/checks/{check_id}/confirm")
def post_confirm(
    order_id: str,
    check_id: str,
    body: EvidenceIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: confirm_check(
            db,
            order_id,
            check_id,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            evidence=body.evidence,
        )
    )


@router.post("/{order_id}/diffs/{diff_id}/close")
def post_close_diff(
    order_id: str,
    diff_id: str,
    body: DiffCloseIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: close_diff(
            db, order_id, diff_id, role=_role(auth, as_role, db), fio=auth.fio or "", note=body.note
        )
    )


@router.post("/{order_id}/gaps/{gap_id}/close")
def post_close_gap(
    order_id: str,
    gap_id: str,
    body: DiffCloseIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: close_gap(db, order_id, gap_id, role=_role(auth, as_role, db), fio=auth.fio or "", note=body.note)
    )


@router.post("/{order_id}/risks")
def post_risk(
    order_id: str,
    body: RiskIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: add_risk(
            db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "", fields=body.model_dump()
        )
    )


@router.post("/{order_id}/decisions")
def post_decision(
    order_id: str,
    body: DecisionIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: add_decision(
            db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "", fields=body.model_dump()
        )
    )


@router.post("/{order_id}/decisions/{decision_id}/close-conditions")
def post_close_conditions(
    order_id: str,
    decision_id: str,
    body: ConditionCloseIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: close_conditions(
            db,
            order_id,
            decision_id,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            document_id=body.document_id,
        )
    )


@router.post("/{order_id}/documents")
def post_document(
    order_id: str,
    body: DocumentIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: add_document(
            db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "", fields=body.model_dump()
        )
    )


@router.get("/{order_id}/files/{document_id}")
def get_order_file(
    order_id: str,
    document_id: str,
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    _ = auth
    from app.services.external_order_case import stored_file
    from app.services.external_orders import _order

    try:
        path, mime, filename = stored_file(_order(db, order_id), document_id)
    except ExternalOrderError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
    return FileResponse(path, media_type=mime or "application/octet-stream", filename=filename)


@router.post("/{order_id}/files/text")
def post_file_text(
    order_id: str,
    body: FileTextIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: save_order_text(
            db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "", fields=body.model_dump()
        )
    )


@router.post("/{order_id}/files")
def post_file(
    order_id: str,
    body: FileIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: upload_order_file(
            db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "", fields=body.model_dump()
        )
    )


@router.post("/{order_id}/files/{document_id}/links")
def post_file_link(
    order_id: str,
    document_id: str,
    body: FileLinkIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: link_order_file(
            db,
            order_id,
            document_id,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            fields=body.model_dump(),
        )
    )


@router.delete("/{order_id}/files/links/{link_id}")
def delete_file_link(
    order_id: str,
    link_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: unlink_order_file(
            db, order_id, link_id, role=_role(auth, as_role, db), fio=auth.fio or ""
        )
    )


@router.post("/{order_id}/files/{document_id}/approve")
def post_approve_file(
    order_id: str,
    document_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: approve_order_file(
            db, order_id, document_id, role=_role(auth, as_role, db), fio=auth.fio or ""
        )
    )


@router.patch("/{order_id}/files/{document_id}")
def patch_file(
    order_id: str,
    document_id: str,
    body: FileEditIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: edit_order_file(
            db,
            order_id,
            document_id,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            fields=body.model_dump(),
        )
    )


@router.delete("/{order_id}/files/{document_id}")
def delete_file(
    order_id: str,
    document_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: delete_order_file(
            db, order_id, document_id, role=_role(auth, as_role, db), fio=auth.fio or ""
        )
    )


@router.post("/{order_id}/baselines")
def post_baseline(
    order_id: str,
    body: BaselineIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: add_baseline(
            db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "", fields=body.model_dump()
        )
    )


@router.post("/{order_id}/plan")
def post_plan(
    order_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(lambda: make_plan(db, order_id, role=_role(auth, as_role, db), fio=auth.fio or ""))


@router.post("/plan/template-outline")
def post_plan_template(
    body: PlanTemplateIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from app.services.external_order_plan import save_template_outline

    role = _role(auth, as_role, db)
    if role not in {"rp", "it", "production", "ks"}:
        raise HTTPException(status_code=403, detail="Структуру шаблона обновляет руководитель проекта или ИТ")
    return _call(lambda: save_template_outline(body.tasks, fio=auth.fio or ""))


@router.post("/{order_id}/plan/preview")
def post_plan_preview(
    order_id: str,
    body: PlanIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from app.services.external_order_plan import preview_work_plan

    _ = _role(auth, as_role, db)
    return _call(lambda: preview_work_plan(db, order_id, overrides=body.overrides, start=body.start))


@router.get("/{order_id}/plan/model")
def get_plan_model(
    order_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from app.services.external_order_plan import preview_work_plan

    _ = _role(auth, as_role, db)
    return _call(lambda: preview_work_plan(db, order_id))


@router.post("/{order_id}/plan/file")
def post_plan_file(
    order_id: str,
    body: PlanIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from app.services.external_order_plan import build_work_plan

    role = _role(auth, as_role, db)
    if role == "viewer":
        raise HTTPException(status_code=403, detail="Просмотр не меняет дело")
    return _call(
        lambda: build_work_plan(db, order_id, fio=auth.fio or "", overrides=body.overrides, start=body.start)
    )


@router.post("/{order_id}/plan/upload-mpp")
def post_plan_mpp(
    order_id: str,
    body: FileIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from app.services.external_order_plan import store_mpp

    role = _role(auth, as_role, db)

    def action() -> dict:
        store_mpp(
            db, order_id, fio=auth.fio or "", role=role, filename=body.filename, content_b64=body.content_base64
        )
        db.commit()
        return get_order(db, order_id)

    return _call(action)


@router.post("/{order_id}/plan/approve")
def post_plan_approve(
    order_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(lambda: accept_plan(db, order_id, role=_role(auth, as_role, db), fio=auth.fio or ""))


@router.post("/{order_id}/plan/publish")
def post_plan_publish(
    order_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: publish_order_plan(db, order_id, role=_role(auth, as_role, db), fio=auth.fio or "")
    )


@router.post("/{order_id}/onec")
def post_onec(
    order_id: str,
    body: OnecLinkIn,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: link_onec(
            db,
            order_id,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            ref_key=body.ref_key,
        )
    )


@router.post("/{order_id}/onec/refresh")
def post_onec_refresh(
    order_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: refresh_onec(
            db,
            order_id,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
        )
    )


@router.post("/{order_id}/copilot")
def post_copilot(
    order_id: str,
    body: CopilotIn | None = None,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    payload = body or CopilotIn()
    return _call(
        lambda: run_copilot(
            db,
            order_id,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            step_id=payload.step_id,
            message=payload.message,
            answers=payload.answers,
            auto_prepare=payload.auto_prepare,
            use_ai=payload.use_ai,
        )
    )


@router.post("/{order_id}/findings/accept-role")
def post_accept_role(
    order_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: accept_role_findings(
            db, order_id, role=_role(auth, as_role, db), fio=auth.fio or ""
        )
    )


@router.post("/{order_id}/findings/{finding_id}/accept")
def post_accept(
    order_id: str,
    finding_id: str,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: accept_finding(
            db, order_id, finding_id, role=_role(auth, as_role, db), fio=auth.fio or ""
        )
    )


class FindingFeedback(BaseModel):
    reason: str = ""
    value: str = ""


@router.post("/{order_id}/findings/{finding_id}/reject")
def post_reject(
    order_id: str,
    finding_id: str,
    body: FindingFeedback | None = None,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    reason = body.reason if body else ""
    return _call(
        lambda: reject_finding(
            db, order_id, finding_id, role=_role(auth, as_role, db), fio=auth.fio or "", reason=reason
        )
    )


@router.post("/{order_id}/findings/{finding_id}/correct")
def post_correct(
    order_id: str,
    finding_id: str,
    body: FindingFeedback,
    as_role: str = Query(default=""),
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _call(
        lambda: correct_finding(
            db,
            order_id,
            finding_id,
            role=_role(auth, as_role, db),
            fio=auth.fio or "",
            value=body.value,
            reason=body.reason,
        )
    )

