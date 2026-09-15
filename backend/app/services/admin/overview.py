from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx
from sqlalchemy import func, select

from app.config import settings
from app.db.session import SessionLocal
from app.models.agent_run import AgentRun
from app.models.user import AppUser
from app.models.workflow import Workflow, WorkflowFile
from app.schemas.admin import (
    AdminAgentStatusesOut,
    AdminAgentStatusSliceOut,
    AdminIntegrationOut,
    AdminMetricOut,
    AdminOverviewOut,
)
from app.services.admin.common import (
    ACTIVE_STATUSES,
    ERROR_STATUSES,
    PENDING_STATUSES,
    SUCCESS_STATUSES,
    build_launch_dynamics,
    is_error,
    last_run_status_by_workflow,
    month_start,
    week_bounds,
    week_period_label,
    workflow_alive,
    workflow_paused,
    workflow_published,
)
from app.services.imap_tools import imap_configured
from app.services.onec_tools import odata_configured

logger = logging.getLogger(__name__)


def _gateway_online() -> bool:
    url = f"http://127.0.0.1:{settings.api_port}/health"
    try:
        with httpx.Client(timeout=2.0) as client:
            response = client.get(url)
            return response.status_code == 200
    except httpx.HTTPError:
        logger.debug("Gateway health ping failed for %s", url)
        return False


def _integration_items(*, kb_online: bool) -> list[AdminIntegrationOut]:
    return [
        AdminIntegrationOut(id="onec", label="1С", online=odata_configured()),
        AdminIntegrationOut(id="outlook", label="Outlook", online=imap_configured()),
        AdminIntegrationOut(
            id="sed",
            label="СЭД",
            online=bool((settings.docflow_odata_base_url or "").strip()),
        ),
        AdminIntegrationOut(id="kb", label="База знаний", online=kb_online),
        AdminIntegrationOut(id="gateway", label="Agent Gateway", online=_gateway_online()),
    ]


def _count_metrics() -> tuple[int, int, int, int, int, int, int, object]:
    week_start, week_end = week_bounds()
    active_since = month_start()
    with SessionLocal() as db:
        workflows = [row for row in db.execute(select(Workflow)).scalars().all() if workflow_alive(row)]
        run_user_ids = {
            str(item)
            for item in db.execute(
                select(AgentRun.user_id).where(AgentRun.started_at >= active_since).distinct()
            ).scalars().all()
            if item
        }
        touched_user_ids = {
            str(item)
            for item in db.execute(
                select(AppUser.id).where(AppUser.updated_at >= active_since)
            ).scalars().all()
            if item
        }
        monthly_users = len(run_user_ids | touched_user_ids)
        active_runs = int(
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
        period_rows = db.execute(
            select(AgentRun.workflow_id, AgentRun.status).where(
                AgentRun.started_at >= week_start,
                AgentRun.started_at < week_end,
            )
        ).all()
        finished = sum(1 for _wf, status in period_rows if (status or "").casefold() in SUCCESS_STATUSES)
        failed = sum(1 for _wf, status in period_rows if (status or "").casefold() in ERROR_STATUSES)
        used_ids = {str(workflow_id) for workflow_id, _status in period_rows if workflow_id}
        agents_used = sum(1 for row in workflows if row.id in used_ids)
        kb_count = int(db.scalar(select(func.count()).select_from(WorkflowFile)) or 0)
        last_status = last_run_status_by_workflow(db)
        dynamics = build_launch_dynamics(db, start=week_start, end=week_end)
        statuses = _agent_statuses(workflows, last_status)
    return (
        len(workflows),
        monthly_users,
        active_runs,
        finished,
        failed,
        agents_used,
        queued,
        (dynamics, statuses, kb_count),
    )


def _success_rate(finished: int, failed: int) -> str:
    total = finished + failed
    if total <= 0:
        return "—"
    return f"{round(100 * finished / total)}%"


def _agent_statuses(workflows: list[Workflow], last_status: dict[str, str]) -> AdminAgentStatusesOut:
    active = pause = setup = error = 0
    for row in workflows:
        if is_error(last_status.get(row.id, "")):
            error += 1
        elif workflow_paused(row):
            pause += 1
        elif workflow_published(row):
            active += 1
        else:
            setup += 1
    total = len(workflows)
    return AdminAgentStatusesOut(
        title="Статусы агентов",
        total=total,
        slices=[
            AdminAgentStatusSliceOut(id="active", label="Активные", value=active, color="#1a73e8"),
            AdminAgentStatusSliceOut(id="pause", label="Пауза", value=pause, color="#2f9e44"),
            AdminAgentStatusSliceOut(id="setup", label="На настройке", value=setup, color="#f0b429"),
            AdminAgentStatusSliceOut(id="error", label="Ошибка", value=error, color="#e8943a"),
        ],
    )


def build_admin_overview(now: datetime | None = None) -> AdminOverviewOut:
    now = now or datetime.now(UTC)
    period_label, date_range = week_period_label(now)
    workflows, monthly_users, active_runs, finished, failed, agents_used, queued, extra = _count_metrics()
    dynamics, statuses, kb_count = extra
    used_pct = round(100 * agents_used / workflows) if workflows else 0
    used_label = f"{agents_used} ({used_pct}%)"
    engaged_pct = used_pct

    metrics = [
        AdminMetricOut(id="agents_total", label="Всего агентов", value=str(workflows or 0), icon="agents_total"),
        AdminMetricOut(id="agents_used", label="Использовались за неделю", value=used_label, icon="agents_used"),
        AdminMetricOut(id="active_runs", label="Активных запусков", value=str(active_runs), icon="active_runs"),
        AdminMetricOut(id="users", label="Пользователей за месяц", value=str(monthly_users), icon="users"),
        AdminMetricOut(
            id="success_rate",
            label="Успешных запусков за неделю",
            value=_success_rate(finished, failed),
            icon="success_rate",
        ),
        AdminMetricOut(id="errors", label="Ошибок за неделю", value=str(failed), icon="errors"),
        AdminMetricOut(id="queue", label="В очереди", value=str(queued), icon="queue"),
        AdminMetricOut(
            id="system_load",
            label="Доля агентов с запусками",
            value=f"{engaged_pct}%",
            icon="system_load",
        ),
    ]

    return AdminOverviewOut(
        breadcrumb="Обзор — Сводная панель администратора",
        dashboard_title="Сводная панель",
        dashboard_subtitle="Ключевые показатели системы ИИ-агентов",
        period_label=period_label,
        date_range=date_range,
        refresh_label="Обновить",
        metrics=metrics,
        launch_dynamics=dynamics,
        agent_statuses=statuses,
        integrations=_integration_items(kb_online=kb_count > 0),
    )
