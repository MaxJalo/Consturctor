"""Admin AI-agents table from workflows of every account."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.agent_run import AgentRun
from app.models.user import AppUser
from app.models.workflow import Workflow
from app.schemas.admin import (
    AdminAgentDetailOut,
    AdminAgentRowOut,
    AdminAiAgentsOut,
    AdminFilterOut,
)
from app.services.admin import stub_payloads
from app.services.admin.common import (
    agent_version,
    count_runs_by_workflow,
    format_dt,
    last_run_status_by_workflow,
    plan_snippet,
    process_title,
    run_status_ui,
    success_rate_label,
    workflow_alive,
    workflow_paused,
    workflow_published,
)

_PAGE_SIZE = 5


def build_admin_ai_agents() -> AdminAiAgentsOut:
    chrome = stub_payloads.stub_ai_agents()
    with SessionLocal() as db:
        workflows = [row for row in db.execute(select(Workflow)).scalars().all() if workflow_alive(row)]
        users = {row.id: row for row in db.execute(select(AppUser)).scalars().all()}
        stats = count_runs_by_workflow(db)
        last_status = last_run_status_by_workflow(db)
        recent = (
            db.execute(select(AgentRun).order_by(AgentRun.started_at.desc()).limit(80)).scalars().all()
        )
        rows = [_row(workflow, users.get(workflow.user_id), stats.get(workflow.id, (0, 0, 0))) for workflow in workflows]
        detail = _detail(workflows, users, stats, last_status, recent)

    statuses = sorted({row.status for row in rows})
    processes = sorted({row.process for row in rows})
    owners = sorted({row.owner for row in rows if row.owner != "—"})
    return AdminAiAgentsOut(
        source="admin_api",
        breadcrumb=str(chrome["breadcrumb"]),
        title=str(chrome["title"]),
        subtitle=str(chrome["subtitle"]),
        create_label=str(chrome["createLabel"]),
        import_label=str(chrome["importLabel"]),
        filters=[
            AdminFilterOut(id="status", options=["Все статусы", *statuses]),
            AdminFilterOut(id="process", options=["Все процессы", *processes[:40]]),
            AdminFilterOut(id="owner", options=["Все владельцы", *owners[:40]]),
        ],
        rows=rows,
        pagination={"pageSize": _PAGE_SIZE, "total": len(rows)},
        detail=detail,
    )


def _row(workflow: Workflow, owner: object | None, stats: tuple[int, int, int]) -> AdminAgentRowOut:
    total, ok, err = stats
    paused = workflow_paused(workflow)
    published = workflow_published(workflow)
    if paused:
        status, tone = "Пауза", "warning"
    elif not published:
        status, tone = "На настройке", "info"
    else:
        status, tone = "Активен", "success"
    title = process_title(workflow)
    owner_fio = getattr(owner, "fio", "") or "—"
    return AdminAgentRowOut(
        name=title,
        process=title,
        owner=owner_fio,
        version=agent_version(workflow),
        status=status,
        status_tone=tone,
        runs=total,
        success_rate=success_rate_label(ok, err),
        used=total > 0,
    )


def _detail(
    workflows: list[Workflow],
    users: dict,
    stats: dict[str, tuple[int, int, int]],
    last_status: dict[str, str],
    recent: list[AgentRun],
) -> AdminAgentDetailOut:
    if not workflows:
        return AdminAgentDetailOut(
            name="Нет агентов",
            status="—",
            status_tone="neutral",
            description="В базе Constructor нет workflow — данные из PostgreSQL backend.",
            tabs=["Обзор"],
            active_tab="Обзор",
            info=[],
            metrics=[],
            processes=[],
        )
    ranked = sorted(workflows, key=lambda row: stats.get(row.id, (0, 0, 0))[0], reverse=True)
    workflow = ranked[0]
    total, ok, err = stats.get(workflow.id, (0, 0, 0))
    owner = users.get(workflow.user_id)
    title = process_title(workflow)
    paused = workflow_paused(workflow)
    published = workflow_published(workflow)
    if paused:
        status, tone = "Пауза", "warning"
    elif not published:
        status, tone = "На настройке", "info"
    else:
        status, tone = "Активен", "success"
    processes = []
    for run in recent:
        if run.workflow_id != workflow.id:
            continue
        label, run_tone, _sla = run_status_ui(run.status)
        processes.append(
            {
                "title": title,
                "time": f"Запущено {format_dt(run.started_at)}",
                "status": label,
                "statusTone": run_tone,
                "tone": "green" if run_tone == "success" else "grey",
            }
        )
        if len(processes) >= 8:
            break
    return AdminAgentDetailOut(
        name=title,
        status=status,
        status_tone=tone,
        description=plan_snippet(workflow.plan_json) or (workflow.notes or "")[:400] or "Опубликованный агент Constructor.",
        tabs=["Обзор", "Текущие процессы", "История запусков"],
        active_tab="Обзор",
        info=[
            {"label": "Владелец", "value": getattr(owner, "fio", None) or "—"},
            {"label": "Версия", "value": agent_version(workflow)},
            {"label": "Последний статус", "value": last_status.get(workflow.id) or "—"},
        ],
        metrics=[
            {"label": "Всего запусков", "value": f"{total:,}".replace(",", " ")},
            {"label": "Успешность", "value": success_rate_label(ok, err)},
            {"label": "Ошибок", "value": str(err)},
        ],
        processes=processes,
    )
