from __future__ import annotations

from datetime import date, datetime, time, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.agent_run import AgentRun
from app.models.workflow import Workflow
from app.schemas.workplace_kpi import (
    WorkplaceKpiAgentRowOut,
    WorkplaceKpiCardOut,
    WorkplaceKpiChartSeriesOut,
    WorkplaceKpiCompareRowOut,
    WorkplaceKpiDashboardOut,
    WorkplaceKpiDynamicsOut,
    WorkplaceKpiProblemZoneOut,
)

DEFAULT_PERIOD_FROM = "2024-08-12"
DEFAULT_PERIOD_TO = "2024-08-18"

_SUCCESS = frozenset({"ok", "success", "successful", "completed", "done", "ready"})
_FAIL = frozenset({"error", "fail", "failed"})


def _parse_day(value: str | None, fallback: str) -> date:
    raw = (value or "").strip() or fallback
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return date.fromisoformat(fallback)


def _period_bounds(day_from: date, day_to: date) -> tuple[datetime, datetime]:
    start = datetime.combine(min(day_from, day_to), time.min, tzinfo=timezone.utc)
    end = datetime.combine(max(day_from, day_to), time.max, tzinfo=timezone.utc)
    return start, end


def _period_label(day_from: date, day_to: date) -> str:
    months = (
        "янв.",
        "февр.",
        "марта",
        "апр.",
        "мая",
        "июня",
        "июля",
        "авг.",
        "сент.",
        "окт.",
        "ноб.",
        "дек.",
    )
    lo, hi = (day_from, day_to) if day_from <= day_to else (day_to, day_from)
    if lo == hi:
        return f"{lo.day} {months[lo.month - 1]} {lo.year}"
    if lo.year == hi.year and lo.month == hi.month:
        return f"{lo.day}–{hi.day} {months[lo.month - 1]} {lo.year}"
    return f"{lo.day} {months[lo.month - 1]} – {hi.day} {months[hi.month - 1]} {hi.year}"


def _status_for(completion: int) -> tuple[str, str]:
    if completion >= 90:
        return "В норме", "green"
    if completion >= 75:
        return "Внимание", "orange"
    return "Риск", "red"


def _reference_agents() -> list[WorkplaceKpiAgentRowOut]:
    rows = [
        ("rig-01", "RIG-01", "Контроль регламентов", "Регламентные работы", 91, 96, 82, 68),
        ("rep-03", "REP-03", "Отчётность KPI", "Еженедельный отчёт", 85, 94, 74, 58),
        ("ml-06", "ML-06", "Обработка почты", "Входящие письма", 79, 88, 71, 55),
        ("reg-02", "REG-02", "Согласование договоров", "Закупки", 72, 90, 65, 48),
    ]
    out: list[WorkplaceKpiAgentRowOut] = []
    for rid, code, name, process, completion, sla, load, auto in rows:
        status, tone = _status_for(completion)
        out.append(
            WorkplaceKpiAgentRowOut(
                id=rid,
                code=code,
                name=name,
                process=process,
                completion_pct=completion,
                sla_pct=sla,
                load_pct=load,
                automation_pct=auto,
                status=status,
                status_tone=tone,
                source="reference",
            )
        )
    return out


def _reference_dashboard(day_from: date, day_to: date) -> WorkplaceKpiDashboardOut:
    label = _period_label(day_from, day_to)
    x_labels = []
    cursor = day_from if day_from <= day_to else day_to
    end = day_to if day_from <= day_to else day_from
    while cursor <= end:
        x_labels.append(f"{cursor.day:02d}.{cursor.month:02d}")
        cursor = date.fromordinal(cursor.toordinal() + 1)

    return WorkplaceKpiDashboardOut(
        period_from=day_from.isoformat(),
        period_to=day_to.isoformat(),
        period_label=label,
        cards=[
            WorkplaceKpiCardOut(
                id="tasks",
                label="Выполнение задач",
                display_value="78%",
                trend="(+12%)",
                progress=78,
                tone="orange",
                source="reference",
            ),
            WorkplaceKpiCardOut(
                id="sla",
                label="SLA",
                display_value="92%",
                progress=92,
                tone="blue",
                source="reference",
            ),
            WorkplaceKpiCardOut(
                id="load",
                label="Загрузка",
                display_value="76%",
                progress=76,
                tone="purple",
                source="reference",
            ),
            WorkplaceKpiCardOut(
                id="ai",
                label="Эффективность ИИ",
                display_value="94%",
                progress=94,
                tone="green",
                source="reference",
            ),
            WorkplaceKpiCardOut(
                id="auto",
                label="Доля автоматизации",
                display_value="62%",
                progress=62,
                tone="yellow",
                source="reference",
            ),
            WorkplaceKpiCardOut(
                id="quality",
                label="Качество",
                display_value="4.7",
                trend="из 5",
                ring=False,
                tone="lilac",
                source="reference",
            ),
        ],
        agents=_reference_agents(),
        problem_zones=[
            WorkplaceKpiProblemZoneOut(
                id="pz1",
                zone="Согласование договоров",
                metric="SLA",
                value="88%",
                severity="orange",
                recommendation="Сократить время ответа сотрудника на запросы агента",
                source="reference",
            ),
            WorkplaceKpiProblemZoneOut(
                id="pz2",
                zone="Отчётность KPI",
                metric="Загрузка",
                value="74%",
                severity="orange",
                recommendation="Пик нагрузки ср–чт — перенести часть запусков",
                source="reference",
            ),
            WorkplaceKpiProblemZoneOut(
                id="pz3",
                zone="Обработка почты",
                metric="Автоматизация",
                value="55%",
                severity="red",
                recommendation="Добавить шаблоны ответов и правила маршрутизации",
                source="reference",
            ),
        ],
        workload_compare=[
            WorkplaceKpiCompareRowOut(id="c1", label="Регламенты", employee=12, ai=28, source="reference"),
            WorkplaceKpiCompareRowOut(id="c2", label="Отчётность", employee=18, ai=22, source="reference"),
            WorkplaceKpiCompareRowOut(id="c3", label="Почта", employee=24, ai=16, source="reference"),
            WorkplaceKpiCompareRowOut(id="c4", label="Задачи 1С", employee=32, ai=14, source="reference"),
        ],
        dynamics=WorkplaceKpiDynamicsOut(
            title="Динамика показателей",
            x_labels=x_labels or ["12.08", "13.08", "14.08", "15.08", "16.08", "17.08", "18.08"],
            y_max=100,
            series=[
                WorkplaceKpiChartSeriesOut(
                    id="tasks",
                    label="Выполнение задач",
                    color="#e8943a",
                    points=[66, 68, 70, 72, 74, 76, 78],
                ),
                WorkplaceKpiChartSeriesOut(
                    id="ai",
                    label="Эффективность ИИ",
                    color="#08745f",
                    points=[88, 89, 90, 91, 92, 93, 94],
                ),
            ],
            source="reference",
        ),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def _is_success(status: str) -> bool:
    value = (status or "").lower()
    return any(token in value for token in _SUCCESS)


def _workflow_code(workflow: Workflow, index: int) -> str:
    plan = workflow.plan_json if isinstance(workflow.plan_json, dict) else {}
    raw = str(plan.get("agent_code") or plan.get("code") or "").strip()
    if raw:
        return raw.upper()
    title = (workflow.title or "").strip()
    if title:
        slug = "".join(ch for ch in title.upper() if ch.isalnum())[:6]
        if slug:
            return slug
    return f"WF-{index + 1:02d}"


def _overlay_from_db(
    db: Session,
    *,
    user_id: str,
    dashboard: WorkplaceKpiDashboardOut,
    start: datetime,
    end: datetime,
) -> WorkplaceKpiDashboardOut:
    runs = list(
        db.execute(
            select(AgentRun).where(
                AgentRun.user_id == user_id,
                AgentRun.started_at >= start,
                AgentRun.started_at <= end,
            )
        )
        .scalars()
        .all()
    )
    workflows = list(
        db.execute(
            select(Workflow).where(Workflow.user_id == user_id, Workflow.phase == "done").order_by(Workflow.title)
        )
        .scalars()
        .all()
    )

    cards = list(dashboard.cards)
    agents = list(dashboard.agents)

    if runs:
        finished = [run for run in runs if _is_success(run.status) or (run.status or "").lower() in _FAIL]
        ok = sum(1 for run in finished if _is_success(run.status))
        total = len(finished) or len(runs)
        task_pct = round(100 * ok / total) if total else 78
        cards[0] = cards[0].model_copy(
            update={
                "display_value": f"{task_pct}%",
                "progress": task_pct,
                "source": "computed",
            }
        )
        sla_pct = task_pct if total >= 3 else cards[1].progress or 92
        cards[1] = cards[1].model_copy(
            update={"display_value": f"{sla_pct}%", "progress": sla_pct, "source": "computed"}
        )
        load_pct = min(100, max(10, round(len(runs) * 4)))
        cards[2] = cards[2].model_copy(
            update={"display_value": f"{load_pct}%", "progress": load_pct, "source": "computed"}
        )

    if workflows:
        by_wf: dict[str, list[AgentRun]] = {}
        for run in runs:
            by_wf.setdefault(run.workflow_id, []).append(run)
        computed_agents: list[WorkplaceKpiAgentRowOut] = []
        for index, wf in enumerate(workflows[:8]):
            wf_runs = by_wf.get(wf.id, [])
            finished = [r for r in wf_runs if _is_success(r.status) or (r.status or "").lower() in _FAIL]
            ok = sum(1 for r in finished if _is_success(r.status))
            total = len(finished) or len(wf_runs)
            completion = round(100 * ok / total) if total else dashboard.agents[min(index, len(dashboard.agents) - 1)].completion_pct
            ref = dashboard.agents[min(index, len(dashboard.agents) - 1)]
            sla = completion if total else ref.sla_pct
            load = min(100, len(wf_runs) * 8) if wf_runs else ref.load_pct
            auto = ref.automation_pct if not total else min(99, max(40, completion - 10))
            status, tone = _status_for(completion)
            computed_agents.append(
                WorkplaceKpiAgentRowOut(
                    id=wf.id,
                    code=_workflow_code(wf, index),
                    name=wf.title or ref.name,
                    process=ref.process,
                    completion_pct=completion,
                    sla_pct=sla,
                    load_pct=load,
                    automation_pct=auto,
                    status=status,
                    status_tone=tone,
                    source="computed" if wf_runs else "reference",
                )
            )
        if computed_agents:
            agents = computed_agents

    return dashboard.model_copy(update={"cards": cards, "agents": agents, "generated_at": datetime.now(timezone.utc).isoformat()})


def build_workplace_kpi_dashboard(
    db: Session,
    *,
    user_id: str,
    period_from: str | None = None,
    period_to: str | None = None,
) -> WorkplaceKpiDashboardOut:
    day_from = _parse_day(period_from, DEFAULT_PERIOD_FROM)
    day_to = _parse_day(period_to, DEFAULT_PERIOD_TO)
    start, end = _period_bounds(day_from, day_to)
    base = _reference_dashboard(day_from, day_to)
    return _overlay_from_db(db, user_id=user_id, dashboard=base, start=start, end=end)
