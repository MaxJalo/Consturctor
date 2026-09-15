"""Admin KPI from agent_runs and workflows across all accounts."""

from __future__ import annotations

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models.agent_run import AgentRun
from app.models.user import AppUser
from app.models.workflow import Workflow
from app.schemas.admin import AdminKpiAgentCardOut, AdminKpiOut, AdminKpiSummaryOut
from app.services.admin import stub_payloads
from app.services.admin.common import (
    ACTIVE_STATUSES,
    PENDING_STATUSES,
    build_launch_dynamics,
    count_runs_by_workflow,
    process_title,
    success_rate_label,
    month_period_label,
    month_start,
    week_bounds,
    workflow_alive,
    workflow_paused,
    workflow_published,
)


def build_admin_kpi() -> AdminKpiOut:
    chrome = stub_payloads.stub_kpi()
    period_label, date_range = month_period_label()
    start, end = week_bounds()
    with SessionLocal() as db:
        stats = count_runs_by_workflow(db)
        workflows = [row for row in db.execute(select(Workflow)).scalars().all() if workflow_alive(row)]
        users = len(
            {
                str(item)
                for item in db.execute(
                    select(AgentRun.user_id).where(AgentRun.started_at >= month_start()).distinct()
                ).scalars().all()
                if item
            }
            | {
                str(item)
                for item in db.execute(select(AppUser.id).where(AppUser.updated_at >= month_start())).scalars().all()
                if item
            }
        )
        active = int(
            db.scalar(
                select(func.count()).select_from(AgentRun).where(AgentRun.status.in_(tuple(ACTIVE_STATUSES)))
            )
            or 0
        )
        queued = int(
            db.scalar(
                select(func.count()).select_from(AgentRun).where(AgentRun.status.in_(tuple(PENDING_STATUSES)))
            )
            or 0
        )
        ok = sum(item[1] for item in stats.values())
        err = sum(item[2] for item in stats.values())
        total_runs = sum(item[0] for item in stats.values())
        durations = db.execute(
            select(AgentRun.started_at, AgentRun.finished_at).where(AgentRun.finished_at.is_not(None)).limit(400)
        ).all()
        avg_label = "—"
        seconds: list[float] = []
        for started, finished in durations:
            if started and finished:
                seconds.append(max(0.0, (finished - started).total_seconds()))
        if seconds:
            avg = int(sum(seconds) / len(seconds))
            avg_label = f"{avg // 60} мин" if avg >= 60 else f"{avg} с"
        dynamics = build_launch_dynamics(db, start=start, end=end)
        cards = _agent_cards(workflows, stats)
        top = sorted(cards, key=lambda item: item.efficiency, reverse=True)[:5]
        published = sum(1 for row in workflows if workflow_published(row) and not workflow_paused(row))
        used_now = sum(1 for row in workflows if stats.get(row.id, (0, 0, 0))[0] > 0)
        load_pct = round(100 * used_now / published) if published else 0

    summaries = [
        AdminKpiSummaryOut(
            id="success",
            label="Успешность задач",
            value=success_rate_label(ok, err),
            tint="green",
        ),
        AdminKpiSummaryOut(id="runs", label="Запусков", value=str(total_runs), tint="none"),
        AdminKpiSummaryOut(id="avg", label="Средняя длительность", value=avg_label, tint="none"),
        AdminKpiSummaryOut(id="errors", label="Ошибок", value=str(err), tint="red" if err else "none"),
        AdminKpiSummaryOut(
            id="agents",
            label="Активных агентов",
            value=str(published),
            icon="target",
            tint="orange",
        ),
        AdminKpiSummaryOut(id="users", label="Пользователей за месяц", value=str(users), tint="none"),
    ]
    gauges = [
        {"id": "cpu", "label": "Активные запуски", "value": str(active), "tone": "cyan" if active else "green"},
        {
            "id": "mem",
            "label": "Загрузка",
            "value": f"{load_pct}%",
            "tone": "orange" if load_pct >= 70 else "green",
        },
        {"id": "queue", "label": "В очереди", "value": str(queued), "tone": "orange" if queued else "green"},
        {
            "id": "avail",
            "label": "Успешность",
            "value": success_rate_label(ok, err) if (ok + err) else "0%",
            "tone": "green",
        },
    ]
    return AdminKpiOut(
        source="admin_api",
        breadcrumb=str(chrome["breadcrumb"]),
        title=str(chrome["title"]),
        subtitle=str(chrome["subtitle"]),
        period_label=period_label,
        date_range=date_range,
        tabs=list(chrome["tabs"]),
        active_tab="general",
        summaries=summaries,
        agent_cards=cards,
        dynamics=dynamics,
        top_agents=[{"label": card.name, "value": card.efficiency} for card in top],
        gauges=gauges,
    )


def _agent_cards(workflows: list[Workflow], stats: dict[str, tuple[int, int, int]]) -> list[AdminKpiAgentCardOut]:
    cards: list[AdminKpiAgentCardOut] = []
    for row in workflows:
        total, ok, err = stats.get(row.id, (0, 0, 0))
        rate = round(100 * ok / (ok + err)) if (ok + err) else 0
        paused = workflow_paused(row)
        published = workflow_published(row)
        if paused:
            status, tone = "Пауза", "warning"
        elif not published:
            status, tone = "На настройке", "info"
        else:
            status, tone = "Активен", "success"
        title = process_title(row)
        cards.append(
            AdminKpiAgentCardOut(
                id=row.id,
                name=title,
                process=title,
                status=status,
                status_tone=tone,
                efficiency=rate,
                summaries=[
                    AdminKpiSummaryOut(id="success", label="Успешность задач", value=f"{rate}%" if total else "—"),
                    AdminKpiSummaryOut(id="runs", label="Запусков", value=str(total)),
                    AdminKpiSummaryOut(id="errors", label="Ошибок", value=str(err)),
                ],
            )
        )
    cards.sort(key=lambda item: item.efficiency, reverse=True)
    return cards[:40]
