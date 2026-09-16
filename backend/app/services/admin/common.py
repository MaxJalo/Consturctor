"""Shared helpers for admin live aggregations (all accounts)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.agent_run import AgentRun
from app.models.workflow import Workflow
from app.schemas.admin import AdminChartSeriesOut, AdminLaunchDynamicsOut
from app.services.triggers.service import is_workflow_paused, workflow_is_deleted

MOSCOW = ZoneInfo("Europe/Moscow")

SUCCESS_STATUSES = frozenset({"finished", "completed", "success", "ok", "done"})
ACTIVE_STATUSES = frozenset({"started", "running", "in_progress"})
PENDING_STATUSES = frozenset({"pending", "queued"})
ERROR_STATUSES = frozenset({"failed", "error"})
CANCEL_STATUSES = frozenset({"canceled", "cancelled"})

_AGENT_COLORS = ("#1a73e8", "#2f9e44", "#7c4dff", "#e8943a", "#e55353", "#0b9b8a")


def now_moscow(now: datetime | None = None) -> datetime:
    stamp = now or datetime.now(UTC)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return stamp.astimezone(MOSCOW)


def week_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    local = now_moscow(now)
    start = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    return start, end


def week_period_label(now: datetime | None = None) -> tuple[str, str]:
    start, end = week_bounds(now)
    last = end - timedelta(seconds=1)
    return "Период: Неделя", f"{start.strftime('%d.%m.%Y')} — {last.strftime('%d.%m.%Y')}"


def month_start(now: datetime | None = None) -> datetime:
    return now_moscow(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_period_label(now: datetime | None = None) -> tuple[str, str]:
    local = now_moscow(now)
    start = month_start(local)
    return "Период: Месяц", f"{start.strftime('%d.%m.%Y')} — {local.strftime('%d.%m.%Y')}"


def format_dt(value: datetime | None) -> str:
    if value is None:
        return "—"
    local = value.astimezone(MOSCOW) if value.tzinfo else value.replace(tzinfo=MOSCOW)
    return local.strftime("%d.%m.%Y %H:%M")


def format_day(value: datetime | None) -> str:
    if value is None:
        return "—"
    local = value.astimezone(MOSCOW) if value.tzinfo else value.replace(tzinfo=MOSCOW)
    return local.strftime("%d.%m.%Y")


def format_duration(started: datetime | None, finished: datetime | None) -> str:
    if started is None:
        return "—"
    end = finished or datetime.now(started.tzinfo or UTC)
    seconds = max(0, int((end - started).total_seconds()))
    if seconds < 60:
        return f"{seconds} с"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} мин"
    hours, minutes = divmod(minutes, 60)
    return f"{hours} ч {minutes} мин"


def run_status_ui(status: str) -> tuple[str, str, str]:
    key = (status or "").strip().casefold()
    if key in SUCCESS_STATUSES:
        return "Завершен", "success", "ok"
    if key in ACTIVE_STATUSES:
        return "В работе", "info", "warn"
    if key in ERROR_STATUSES:
        return "Ошибка", "error", "fail"
    if key in CANCEL_STATUSES:
        return "Отменен", "neutral", "warn"
    return status or "—", "neutral", "ok"


def is_success(status: str) -> bool:
    return (status or "").strip().casefold() in SUCCESS_STATUSES


def is_error(status: str) -> bool:
    return (status or "").strip().casefold() in ERROR_STATUSES


def is_active(status: str) -> bool:
    return (status or "").strip().casefold() in ACTIVE_STATUSES


def workflow_alive(row: Workflow) -> bool:
    return not workflow_is_deleted(row)


def workflow_published(row: Workflow) -> bool:
    local = row.local_run if isinstance(row.local_run, dict) else {}
    return workflow_alive(row) and bool(local.get("published") or row.phase == "done")


def workflow_paused(row: Workflow) -> bool:
    return is_workflow_paused(row.local_run)


def process_title(row: Workflow) -> str:
    plan = row.plan_json if isinstance(row.plan_json, dict) else {}
    title = str(plan.get("title") or row.title or "").strip()
    return title or "Без названия"


def agent_version(row: Workflow) -> str:
    local = row.local_run if isinstance(row.local_run, dict) else {}
    plan = row.plan_json if isinstance(row.plan_json, dict) else {}
    for key in ("version", "agent_version", "playbook_version"):
        value = str(local.get(key) or plan.get(key) or "").strip()
        if value:
            return value
    return "1.0"


def color_for(index: int) -> str:
    return _AGENT_COLORS[index % len(_AGENT_COLORS)]


def history_tab_for(run: AgentRun) -> str:
    source = (run.source or "").strip().casefold()
    kind_key = (run.trigger_kind or "").strip().casefold()
    kind = f"{kind_key} {run.trigger_reason or ''} {run.message or ''}".casefold()
    if kind_key in {"mail", "imap", "outlook", "email"} or any(
        token in kind for token in ("mail", "outlook", "imap", "письм", "email")
    ):
        return "letters"
    if any(token in kind for token in ("проект", "turboproject", "project")):
        return "project_tasks"
    if source in {"trigger", "schedule"} or kind_key in {"interval", "cron", "once", "schedule"}:
        return "tasks"
    if "task" in kind or "поруч" in kind:
        return "tasks"
    return "processes"


def empty_launch_dynamics(*, title: str = "Динамика запусков агентов") -> AdminLaunchDynamicsOut:
    labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    zeros = [0] * 7
    return AdminLaunchDynamicsOut(
        title=title,
        y_max=10,
        y_ticks=[0, 5, 10],
        x_labels=labels,
        series=[
            AdminChartSeriesOut(id="success", label="Успешные", color="#2f9e44", points=list(zeros)),
            AdminChartSeriesOut(id="processing", label="В обработке", color="#1a73e8", points=list(zeros)),
            AdminChartSeriesOut(id="errors", label="С ошибками", color="#e55353", points=list(zeros)),
        ],
        legend=[
            {"id": "success", "label": "Успешные", "color": "#2f9e44"},
            {"id": "processing", "label": "В обработке", "color": "#1a73e8"},
            {"id": "errors", "label": "С ошибками", "color": "#e55353"},
        ],
    )


def build_launch_dynamics(
    db: Session,
    *,
    start: datetime,
    end: datetime,
    title: str = "Динамика запусков агентов",
) -> AdminLaunchDynamicsOut:
    rows = db.execute(
        select(AgentRun.started_at, AgentRun.status).where(
            AgentRun.started_at >= start,
            AgentRun.started_at < end,
        )
    ).all()
    success = [0] * 7
    processing = [0] * 7
    errors = [0] * 7
    labels: list[str] = []
    for offset in range(7):
        day = start + timedelta(days=offset)
        labels.append(day.strftime("%d.%m"))
    for started, status in rows:
        if started is None:
            continue
        local = started.astimezone(MOSCOW) if started.tzinfo else started.replace(tzinfo=MOSCOW)
        idx = (local.date() - start.astimezone(MOSCOW).date()).days
        if idx < 0 or idx > 6:
            continue
        if is_success(str(status)):
            success[idx] += 1
        elif is_error(str(status)):
            errors[idx] += 1
        else:
            processing[idx] += 1
    peak = max([*success, *processing, *errors, 10])
    step = 50 if peak > 80 else (10 if peak > 20 else 5)
    y_max = max(step, int((peak + step - 1) // step * step))
    ticks = list(range(0, y_max + 1, max(step, 1)))
    if len(ticks) > 6:
        ticks = [0, y_max // 2, y_max]
    return AdminLaunchDynamicsOut(
        title=title,
        y_max=y_max,
        y_ticks=ticks,
        x_labels=labels,
        series=[
            AdminChartSeriesOut(id="success", label="Успешные", color="#2f9e44", points=success),
            AdminChartSeriesOut(id="processing", label="В обработке", color="#1a73e8", points=processing),
            AdminChartSeriesOut(id="errors", label="С ошибками", color="#e55353", points=errors),
        ],
        legend=[
            {"id": "success", "label": "Успешные", "color": "#2f9e44"},
            {"id": "processing", "label": "В обработке", "color": "#1a73e8"},
            {"id": "errors", "label": "С ошибками", "color": "#e55353"},
        ],
    )


def success_rate_label(ok: int, failed: int) -> str:
    total = ok + failed
    if total <= 0:
        return "—"
    return f"{round(100 * ok / total)}%"


def count_runs_by_workflow(db: Session) -> dict[str, tuple[int, int, int]]:
    """workflow_id -> (total, success, error)."""
    rows = db.execute(
        select(AgentRun.workflow_id, AgentRun.status, func.count()).group_by(
            AgentRun.workflow_id, AgentRun.status
        )
    ).all()
    out: dict[str, tuple[int, int, int]] = {}
    for workflow_id, status, count in rows:
        total, ok, err = out.get(str(workflow_id), (0, 0, 0))
        n = int(count or 0)
        total += n
        if is_success(str(status)):
            ok += n
        elif is_error(str(status)):
            err += n
        out[str(workflow_id)] = (total, ok, err)
    return out


def last_run_status_by_workflow(db: Session) -> dict[str, str]:
    latest = (
        select(AgentRun.workflow_id, func.max(AgentRun.started_at).label("ts"))
        .group_by(AgentRun.workflow_id)
        .subquery()
    )
    rows = db.execute(
        select(AgentRun.workflow_id, AgentRun.status).join(
            latest,
            (AgentRun.workflow_id == latest.c.workflow_id) & (AgentRun.started_at == latest.c.ts),
        )
    ).all()
    return {str(workflow_id): str(status or "") for workflow_id, status in rows}


def plan_snippet(plan: Any) -> str:
    if isinstance(plan, dict):
        for key in ("summary", "goal", "description", "instructions"):
            text = str(plan.get(key) or "").strip()
            if text:
                return text[:400]
    return ""
