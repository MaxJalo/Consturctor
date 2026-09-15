"""Admin history: agent runs across all accounts."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.agent_run import AgentRun
from app.models.user import AppUser
from app.models.workflow import Workflow
from app.schemas.admin import AdminFilterOut, AdminHistoryOut, AdminHistoryRowOut
from app.services.admin import stub_payloads
from app.services.admin.common import (
    format_dt,
    format_duration,
    history_tab_for,
    process_title,
    run_status_ui,
    week_period_label,
    workflow_alive,
)

_PAGE_SIZE = 10
_LIMIT = 800


def build_admin_history() -> AdminHistoryOut:
    chrome = stub_payloads.stub_history()
    period_label, date_range = week_period_label()
    with SessionLocal() as db:
        rows = _load_rows(db)
    filters = _filters(rows)
    return AdminHistoryOut(
        source="admin_api",
        breadcrumb=str(chrome["breadcrumb"]),
        title=str(chrome["title"]),
        subtitle=str(chrome["subtitle"]),
        period_label=period_label,
        date_range=date_range,
        tabs=list(chrome["tabs"]),
        active_tab="processes",
        filters=filters,
        rows=rows,
        pagination={"pageSize": _PAGE_SIZE, "total": len(rows)},
    )


def _load_rows(db: Session) -> list[AdminHistoryRowOut]:
    runs = (
        db.execute(select(AgentRun).order_by(AgentRun.started_at.desc()).limit(_LIMIT))
        .scalars()
        .all()
    )
    if not runs:
        return []
    wf_ids = {row.workflow_id for row in runs}
    user_ids = {row.user_id for row in runs}
    workflows = {
        item.id: item
        for item in db.execute(select(Workflow).where(Workflow.id.in_(wf_ids))).scalars().all()
    }
    users = {
        item.id: item
        for item in db.execute(select(AppUser).where(AppUser.id.in_(user_ids))).scalars().all()
    }
    out: list[AdminHistoryRowOut] = []
    for run in runs:
        workflow = workflows.get(run.workflow_id)
        user = users.get(run.user_id)
        status, tone, sla = run_status_ui(run.status)
        if workflow is None:
            title = "Агент удалён"
        elif not workflow_alive(workflow):
            title = f"{process_title(workflow)} (удалён)"
        else:
            title = process_title(workflow)
        out.append(
            AdminHistoryRowOut(
                id=(run.id or "")[:8].upper() or run.id,
                process=title,
                agent=title,
                user=(user.fio if user else "") or "—",
                status=status,
                status_tone=tone,
                launched_at=format_dt(run.started_at),
                duration=format_duration(run.started_at, run.finished_at),
                sla=sla,
                tab=history_tab_for(run),
            )
        )
    return out


def _filters(rows: list[AdminHistoryRowOut]) -> list[AdminFilterOut]:
    buckets: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        buckets["status"].add(row.status)
        buckets["agent"].add(row.agent)
        buckets["process"].add(row.process)
        buckets["user"].add(row.user)
    return [
        AdminFilterOut(id="status", options=["Все статусы", *sorted(buckets["status"])]),
        AdminFilterOut(id="agent", options=["Все агенты", *sorted(buckets["agent"])[:40]]),
        AdminFilterOut(id="process", options=["Все процессы", *sorted(buckets["process"])[:40]]),
        AdminFilterOut(id="user", options=["Все пользователи", *sorted(buckets["user"])[:40]]),
    ]
