"""Admin launch calendar from agent_triggers across all accounts."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.trigger import AgentTrigger
from app.models.workflow import Workflow
from app.schemas.admin import AdminCalendarEventOut, AdminLaunchCalendarOut
from app.services.admin import stub_payloads
from app.services.admin.common import (
    color_for,
    now_moscow,
    process_title,
    week_bounds,
    week_period_label,
    workflow_alive,
    workflow_paused,
    workflow_published,
)

_WEEKDAYS = ("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")
_HOURS = [f"{hour:02d}:00" for hour in range(8, 21)]
_TONES = ("green", "blue", "purple", "yellow", "red")


def build_admin_launch_calendar() -> AdminLaunchCalendarOut:
    chrome = stub_payloads.stub_launch_calendar()
    now = now_moscow()
    start, end = week_bounds(now)
    period_label, date_range = week_period_label(now)
    last = end - timedelta(seconds=1)
    week_range = f"{start.strftime('%d.%m.%Y')} — {last.strftime('%d.%m.%Y')}"
    days = [
        f"{_WEEKDAYS[idx]} {(start + timedelta(days=idx)).strftime('%d.%m')}" for idx in range(7)
    ]

    with SessionLocal() as db:
        events, filters, unscheduled = _collect(db)

    mini_days = _mini_days(now)
    return AdminLaunchCalendarOut(
        source="admin_api",
        breadcrumb=str(chrome["breadcrumb"]),
        title=str(chrome["title"]),
        subtitle=str(chrome["subtitle"]),
        period_label=period_label,
        date_range=date_range,
        create_label=str(chrome["createLabel"]),
        view_modes=list(chrome["viewModes"]),
        active_view="Неделя",
        week_range=week_range,
        days=days,
        hours=_HOURS,
        events=events,
        agent_filters=filters,
        mini_month=now.strftime("%B %Y").capitalize() if False else _month_title(now),
        mini_days=mini_days,
        unscheduled=unscheduled,
        schedule_all_label=str(chrome["scheduleAllLabel"]),
    )


def _month_title(now) -> str:
    months = (
        "Январь",
        "Февраль",
        "Март",
        "Апрель",
        "Май",
        "Июнь",
        "Июль",
        "Август",
        "Сентябрь",
        "Октябрь",
        "Ноябрь",
        "Декабрь",
    )
    return f"{months[now.month - 1]} {now.year}"


def _mini_days(now) -> list[dict]:
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    days: list[dict] = []
    cursor = start
    while cursor.month == now.month:
        item: dict = {"day": cursor.day}
        if cursor.date() == now.date():
            item["active"] = True
        days.append(item)
        cursor += timedelta(days=1)
    return days


def _collect(db: Session) -> tuple[list[AdminCalendarEventOut], list[dict], list[dict]]:
    workflows = {
        row.id: row
        for row in db.execute(select(Workflow)).scalars().all()
        if workflow_alive(row)
    }
    triggers = (
        db.execute(select(AgentTrigger).where(AgentTrigger.enabled.is_(True))).scalars().all()
    )
    scheduled_ids: set[str] = set()
    events: list[AdminCalendarEventOut] = []
    agent_index: dict[str, int] = {}

    for trigger in triggers:
        workflow = workflows.get(trigger.workflow_id)
        if workflow is None or workflow_paused(workflow):
            continue
        scheduled_ids.add(workflow.id)
        title = process_title(workflow)
        if workflow.id not in agent_index:
            agent_index[workflow.id] = len(agent_index)
        hour = _hour_for(trigger)
        weekdays = _active_weekdays(trigger)
        for day_index in weekdays:
            events.append(
                AdminCalendarEventOut(
                    id=f"{trigger.id}:{day_index}",
                    day_index=day_index,
                    start_hour=hour,
                    end_hour=min(hour + 1, 23),
                    title=title,
                    tone=_TONES[agent_index[workflow.id] % len(_TONES)],
                    agent_id=workflow.id,
                )
            )
            if len(events) >= 240:
                break
        if len(events) >= 240:
            break

    filters = [
        {"id": "all", "label": "Все агенты", "color": "#1a73e8", "checked": True},
        *[
            {
                "id": wf_id,
                "label": process_title(workflows[wf_id]),
                "color": color_for(idx),
                "checked": True,
            }
            for wf_id, idx in list(agent_index.items())[:24]
        ],
    ]
    unscheduled = []
    for workflow in workflows.values():
        if workflow.id in scheduled_ids:
            continue
        if not workflow_published(workflow):
            continue
        unscheduled.append(
            {
                "id": workflow.id,
                "title": process_title(workflow),
                "subtitle": "Без расписания",
                "tone": "purple",
            }
        )
        if len(unscheduled) >= 20:
            break
    return events, filters, unscheduled


def _hour_for(trigger: AgentTrigger) -> int:
    if trigger.window_start_min is not None:
        return max(8, min(20, int(trigger.window_start_min) // 60))
    if trigger.fire_at is not None:
        local = trigger.fire_at
        if local.tzinfo:
            from app.services.admin.common import MOSCOW

            local = local.astimezone(MOSCOW)
        return max(8, min(20, local.hour))
    return 9


def _active_weekdays(trigger: AgentTrigger) -> list[int]:
    raw = (trigger.active_days or "").strip()
    if not raw:
        return list(range(7)) if trigger.interval_seconds or not trigger.once else [0]
    days: list[int] = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            value = int(part)
        except ValueError:
            continue
        if 0 <= value <= 6:
            days.append(value)
    return days or list(range(7))
