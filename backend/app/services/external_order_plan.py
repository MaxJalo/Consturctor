"""Файл плана работ по заказу: этапы и обязательные условия договора.

Общий шаблон на сетевом диске не перезаписывается. Человек забирает отдельный файл из дела.
Project на сервере не сохраняет бинарный mpp без окна, поэтому файл — проект XML, который Project открывает.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree as ET

from sqlalchemy.orm import Session

from app.config import BACKEND_ROOT
from app.models.external_order import ExternalOrder, ExternalOrderDocument
from app.services.external_order_case import _PLAN

_NS = "http://schemas.microsoft.com/project"
_MISSING = "в договоре дела нет"
_PLAN_KIND = "plan"
_MIME = "application/xml"

# Эти подписи обязаны быть задачами плана, даже если в деле значения нет.
_CONDITIONS = (
    ("subject", "Предмет", ("subject", "предмет")),
    ("composition", "Состав", ("composition", "состав")),
    ("quantity", "Количество", ("quantity", "количество", "qty")),
    ("price", "Цена", ("price", "цена", "cost")),
    ("vat", "НДС", ("vat", "ндс")),
    ("term", "Сроки", ("term", "срок", "deadlines")),
    ("payment", "Оплата", ("payment", "оплат", "bdds")),
    ("completeness", "Комплектность", ("completeness", "комплект")),
    ("acceptance", "Приёмка", ("acceptance", "приемк")),
    ("warranty", "Гарантия", ("warranty", "гаранти")),
)


def _tag(name: str) -> str:
    return f"{{{_NS}}}{name}"


def _text(parent: ET.Element, name: str, value: str) -> None:
    node = ET.SubElement(parent, _tag(name))
    node.text = value


def _sections(order: ExternalOrder) -> dict:
    try:
        data = json.loads(order.sections_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _walk(node: object, keys: set[str]) -> str:
    if isinstance(node, dict):
        for key, value in node.items():
            if str(key).casefold() in keys and isinstance(value, str) and value.strip():
                return value.strip()
            found = _walk(value, keys)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _walk(item, keys)
            if found:
                return found
    return ""


def _finding(order: ExternalOrder, keys: set[str]) -> str:
    ranked = sorted(
        (
            item
            for item in order.findings
            if str(item.field or "").casefold() in keys and str(item.value or "").strip()
        ),
        key=lambda item: 0 if item.status == "accepted" else 1,
    )
    return str(ranked[0].value).strip() if ranked else ""


def _baseline_value(order: ExternalOrder, key: str) -> str:
    rows = list(order.baselines)
    if not rows:
        return ""
    row = rows[-1]
    if key == "composition":
        return str(row.composition or "").strip()
    if key == "price":
        return str(row.cost or "").strip()
    if key == "term":
        return str(row.deadlines or "").strip()
    if key == "payment":
        return str(row.bdds or "").strip()
    return ""


def contract_conditions(order: ExternalOrder) -> list[dict[str, str]]:
    """Десять условий договора. Пустое значение не подменяется выдуманным текстом."""
    sections = _sections(order)
    lines = [item for item in order.lines if str(item.name or "").strip()]
    rows: list[dict[str, str]] = []
    for key, label, aliases in _CONDITIONS:
        names = {key, *aliases}
        value = _finding(order, names) or _walk(sections, names) or _baseline_value(order, key)
        if not value and key == "composition" and lines:
            value = "; ".join(str(item.name).strip() for item in lines)
        if not value and key == "quantity" and lines:
            value = "; ".join(str(item.qty).strip() for item in lines if str(item.qty or "").strip())
        rows.append({"key": key, "label": label, "value": value or _MISSING})
    return rows


def contract_number(order: ExternalOrder) -> str:
    onec = _sections(order).get("onec")
    if not isinstance(onec, dict):
        return ""
    return str(onec.get("contract_number") or "").strip()


def work_tasks(order: ExternalOrder) -> list[dict[str, str]]:
    from app.services.external_order_case import _applies

    rows: list[dict[str, str]] = []
    for title, kind, _owner in _PLAN:
        if title == "Испытания" and not _applies(order.route, order.order_type, "before_psi", title)[0]:
            continue
        rows.append({"title": title, "kind": kind})
    return rows


def plan_xml(
    *,
    code: str,
    customer: str,
    product: str,
    contract: str,
    work: list[dict[str, str]],
    conditions: list[dict[str, str]],
) -> bytes:
    start = datetime.now(timezone.utc).replace(hour=8, minute=0, second=0, microsecond=0)
    root = ET.Element(_tag("Project"))
    title = f"План работ {code}".strip()
    _text(root, "SaveVersion", "14")
    _text(root, "Name", title)
    _text(root, "Title", f"{title}. {customer}. {product}".strip(" ."))
    _text(root, "ScheduleFromStart", "1")
    _text(root, "StartDate", start.strftime("%Y-%m-%dT%H:%M:%S"))
    _text(root, "CalendarUID", "1")
    _text(root, "DefaultStartTime", "08:00:00")
    _text(root, "DefaultFinishTime", "17:00:00")
    _text(root, "MinutesPerDay", "480")
    _text(root, "MinutesPerWeek", "2400")
    _text(root, "DaysPerMonth", "20")
    tasks = ET.SubElement(root, _tag("Tasks"))
    contract_note = f"Договор: {contract}" if contract else "Номер договора в деле не указан"
    header = (
        "Черновик плана работ. Общий шаблон «Шаблон плана без РУКОВОДСТВА.mpp» не изменялся. "
        + contract_note
    )
    _task(tasks, uid=0, name=title, level=0, summary=True, start=start, hours=8, notes=header)
    _task(tasks, uid=1, name="План работ", level=1, summary=True, start=start, hours=8, notes="")
    previous = 0
    uid = 2
    for item in work:
        milestone = item.get("kind") == "milestone"
        hours = 0 if milestone else 40
        _task(
            tasks,
            uid=uid,
            name=item["title"],
            level=2,
            summary=False,
            start=start,
            hours=hours,
            notes="",
            predecessor=previous if previous else 0,
            milestone=milestone,
        )
        previous = uid
        uid += 1
        start = start + timedelta(days=1 if milestone else 5)
    _task(
        tasks,
        uid=uid,
        name="Условия договора",
        level=1,
        summary=True,
        start=start,
        hours=8,
        notes=contract_note,
    )
    uid += 1
    for item in conditions:
        _task(
            tasks,
            uid=uid,
            name=item["label"],
            level=2,
            summary=False,
            start=start,
            hours=8,
            notes=item["value"],
            milestone=False,
        )
        uid += 1
    _calendar(root)
    ET.SubElement(root, _tag("Resources"))
    ET.SubElement(root, _tag("Assignments"))
    raw = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return raw


def _task(
    parent: ET.Element,
    *,
    uid: int,
    name: str,
    level: int,
    summary: bool,
    start: datetime,
    hours: int,
    notes: str,
    predecessor: int = 0,
    milestone: bool = False,
) -> None:
    node = ET.SubElement(parent, _tag("Task"))
    _text(node, "UID", str(uid))
    _text(node, "ID", str(uid))
    _text(node, "Name", name)
    _text(node, "Type", "1")
    _text(node, "IsNull", "0")
    _text(node, "OutlineLevel", str(level))
    _text(node, "Priority", "500")
    _text(node, "Start", start.strftime("%Y-%m-%dT%H:%M:%S"))
    _text(node, "Duration", f"PT{hours}H0M0S")
    _text(node, "DurationFormat", "7" if not milestone else "5")
    _text(node, "Summary", "1" if summary else "0")
    _text(node, "Milestone", "1" if milestone else "0")
    if notes:
        _text(node, "Notes", notes)
    if predecessor:
        link = ET.SubElement(node, _tag("PredecessorLink"))
        _text(link, "PredecessorUID", str(predecessor))
        _text(link, "Type", "1")


def _calendar(root: ET.Element) -> None:
    calendars = ET.SubElement(root, _tag("Calendars"))
    calendar = ET.SubElement(calendars, _tag("Calendar"))
    _text(calendar, "UID", "1")
    _text(calendar, "Name", "Стандартный")
    _text(calendar, "IsBaseCalendar", "1")
    _text(calendar, "BaseCalendarUID", "-1")
    days = ET.SubElement(calendar, _tag("WeekDays"))
    for day_type in range(1, 8):
        day = ET.SubElement(days, _tag("WeekDay"))
        _text(day, "DayType", str(day_type))
        working = day_type not in {1, 7}
        _text(day, "DayWorking", "1" if working else "0")
        if not working:
            continue
        times = ET.SubElement(day, _tag("WorkingTimes"))
        for begin, end in (("08:00:00", "12:00:00"), ("13:00:00", "17:00:00")):
            slot = ET.SubElement(times, _tag("WorkingTime"))
            _text(slot, "FromTime", begin)
            _text(slot, "ToTime", end)


def _safe_name(code: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in " ._-" else "_" for ch in (code or "заказ"))
    return f"План работ {cleaned.strip() or 'заказ'}.xml"


def _drop_draft(order: ExternalOrder, doc: ExternalOrderDocument) -> None:
    path = Path(doc.stored_path) if doc.stored_path else None
    if path and path.is_file():
        path.unlink()
    order.documents.remove(doc)


def build_work_plan(db: Session, order_id: str, *, fio: str) -> dict:
    from app.services.external_orders import _audit, _order

    order = _order(db, order_id)
    for doc in [item for item in order.documents if item.kind == _PLAN_KIND and not item.approved]:
        _drop_draft(order, doc)
    conditions = contract_conditions(order)
    work = work_tasks(order)
    number = contract_number(order)
    raw = plan_xml(
        code=order.code,
        customer=order.customer,
        product=order.product,
        contract=number,
        work=work,
        conditions=conditions,
    )
    doc_id = uuid4().hex
    folder = BACKEND_ROOT / "storage" / "external_orders" / order.id
    folder.mkdir(parents=True, exist_ok=True)
    filename = _safe_name(order.code)
    path = folder / f"{doc_id}_{filename}"
    path.write_bytes(raw)
    db.add(
        ExternalOrderDocument(
            id=doc_id,
            order_id=order.id,
            kind=_PLAN_KIND,
            title=f"План работ {order.code}",
            version="v1",
            note="Черновик. Условия договора включены в задачи. Фактом не является, пока человек не утвердит.",
            file_name=filename,
            stored_path=str(path),
            mime=_MIME,
            sha256="",
            owner_role="production",
        )
    )
    missing = [item["label"] for item in conditions if item["value"] == _MISSING]
    filled = [f"{item['label']}: {item['value']}" for item in conditions if item["value"] != _MISSING]
    _audit(db, order, fio=fio or "агент", role="production", action="plan_file", detail=filename)
    db.commit()
    parts = [f"План работ {order.code} записан в дело: {filename}."]
    parts.append("Откройте файл в Project. Общий шаблон на диске не менялся.")
    if number:
        parts.append(f"Договор {number}.")
    if filled:
        parts.append("Условия из дела: " + "; ".join(filled) + ".")
    if missing:
        parts.append("В договоре дела нет: " + ", ".join(missing) + ".")
    parts.append("Черновик фактом не является.")
    return {
        "ok": True,
        "summary": " ".join(parts),
        "file_name": filename,
        "document_id": doc_id,
        "missing": missing,
    }


def plan_file_path(order: ExternalOrder, document_id: str) -> Path:
    from app.services.external_orders import ExternalOrderError

    doc = next((item for item in order.documents if item.id == document_id), None)
    if doc is None or not doc.stored_path:
        raise ExternalOrderError("Файл плана не найден", 404)
    path = Path(doc.stored_path).resolve()
    root = (BACKEND_ROOT / "storage" / "external_orders" / order.id).resolve()
    if root != path and root not in path.parents:
        raise ExternalOrderError("Файл плана не найден", 404)
    if not path.is_file():
        raise ExternalOrderError("Файл плана не найден", 404)
    return path
