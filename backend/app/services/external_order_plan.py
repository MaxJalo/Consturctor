"""План работ по заказу: модель плана, MSPDI XML для Project и .mpp, собранный на ПК.

Общий шаблон на сетевом диске не перезаписывается. Структура задач берётся из выгрузки шаблона,
сроки — из дела, календарь — производственный календарь РФ. Чего в деле нет, не выдумывается.
"""

from __future__ import annotations

import base64
import binascii
import json
import math
import re
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree as ET

from sqlalchemy.orm import Session

from app.config import BACKEND_ROOT
from app.models.external_order import ExternalOrder, ExternalOrderDocument
from app.services import ru_work_calendar as cal

_NS = "http://schemas.microsoft.com/project"
_MISSING = "в договоре дела нет"
_PLAN_KIND = "plan"
_MIME = "application/xml"
_MPP_MIME = "application/vnd.ms-project"
TEMPLATE_NAME = "Шаблон плана без РУКОВОДСТВА.mpp"
_TEMPLATE_CACHE = BACKEND_ROOT / "app" / "static" / "external_order_plan_template.json"

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

RESOURCES: dict[str, str] = {
    "ks": "Коммерческая служба",
    "finance": "ОЦОиЭП и финансы",
    "committee": "Комитет",
    "legal": "Юридическая служба",
    "rp": "Руководитель проекта",
    "kb": "КБ и ГСПП",
    "omto": "ОМТО",
    "production": "Производство",
    "otk": "ОТК",
}

# key, name, level, milestone, resource, норматив в рабочих днях, только до подписания договора
_BUILTIN: tuple[tuple[str, str, int, bool, str, int, bool], ...] = (
    ("prep", "Подготовка и согласование", 1, False, "", 0, True),
    ("request", "Уточнение требований и комплектование", 2, False, "ks", 5, True),
    ("calc", "Расчёт себестоимости и сроков", 2, False, "finance", 5, True),
    ("committee", "Решение Комитета", 2, True, "committee", 0, True),
    ("tkp", "ТКП заказчику", 2, False, "ks", 3, True),
    ("contract", "Подписание договора", 2, True, "ks", 0, False),
    ("run", "Исполнение", 1, False, "", 0, False),
    ("kd", "Выпуск КД", 2, False, "kb", 10, False),
    ("omto", "Закупки ОМТО", 2, False, "omto", 15, False),
    ("make", "Изготовление", 2, False, "production", 15, False),
    ("psi", "ПСИ", 2, False, "otk", 3, False),
    ("accept", "Приёмка ОТК и заказчика", 2, False, "otk", 2, False),
    ("ship", "Отгрузка", 2, True, "omto", 0, False),
    ("close", "Оплата и закрытие", 1, False, "", 0, False),
    ("pay", "Оплата 100%", 2, True, "finance", 0, False),
)

# Задачи исполнения, которые растягиваются под срок договора.
_RUN_KEYS = ("kd", "omto", "make", "psi", "accept")
_EVENT_KEYS = {"committee", "contract", "ship", "pay"}
_KEYWORDS = (
    ("contract", ("договор",)),
    ("committee", ("комитет",)),
    ("tkp", ("ткп", "коммерческ")),
    ("calc", ("расчёт", "расчет", "себестоим")),
    ("request", ("требован", "запрос", "комплектов")),
    ("kd", ("кд", "конструктор", "документац")),
    ("omto", ("закуп", "омто", "снабжен")),
    ("make", ("изготов", "производ")),
    ("psi", ("пси", "испытан")),
    ("accept", ("приёмк", "приемк")),
    ("ship", ("отгруз",)),
    ("pay", ("оплат",)),
)
_SECTION_DAYS = {"omto": ("omto", "cycle"), "make": ("production", "cycle")}
_SIGNED_STATUSES = {
    "contract_signed",
    "in_progress",
    "production",
    "acceptance",
    "shipped",
    "awaiting_payment",
    "closed",
}


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
            if str(item.field or "").casefold() in keys and str(item.value or "").strip() and item.status != "rejected"
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


_DATE = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2})")
_TERM = re.compile(
    r"(\d{1,4})\s*(?:\(\D{0,40}\)\s*)?(рабоч\w*\s+|календ\w*\s+|раб\.\s*|кал\.\s*)?(дн|день|дня|недел|мес)",
    re.IGNORECASE,
)


def _date_in(text: str) -> date | None:
    match = _DATE.search(text or "")
    if not match:
        return None
    try:
        found = (
            date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
            if match.group(1)
            else date(int(match.group(4)), int(match.group(5)), int(match.group(6)))
        )
    except ValueError:
        return None
    if found.year < 1900:
        return None
    return found


def _days_in(text: str) -> int:
    """Срок в рабочих днях из текста «90 календарных дней», «12 недель», «4 месяца»."""
    match = _TERM.search(text or "")
    if not match:
        return 0
    value = int(match.group(1))
    kind = (match.group(2) or "").casefold()
    unit = match.group(3).casefold()
    if unit.startswith("недел"):
        return value * 5
    if unit.startswith("мес"):
        return value * 21
    if kind.startswith("раб"):
        return value
    return math.ceil(value * 5 / 7)


def _signed_on(order: ExternalOrder) -> date | None:
    from app.services.external_orders import STATUSES

    label = STATUSES["contract_signed"]
    stamps = [
        item.created_at
        for item in order.audit
        if item.action == "transition" and item.after_value == label and item.created_at
    ]
    if stamps:
        return max(stamps).date()
    onec = _sections(order).get("onec")
    if isinstance(onec, dict):
        for key in ("deal_start", "order_date"):
            found = _date_in(str(onec.get(key) or ""))
            if found:
                return found
    return None


def _schedule(order: ExternalOrder) -> list[dict[str, str]]:
    onec = _sections(order).get("onec")
    raw = onec.get("schedule") if isinstance(onec, dict) else None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "[]")
        except json.JSONDecodeError:
            raw = []
    return [item for item in raw or [] if isinstance(item, dict)]


def _psi_applies(order: ExternalOrder) -> bool:
    from app.services.external_order_case import _applies

    return bool(_applies(order.route, order.order_type, "before_psi", "Испытания")[0])


def load_template_outline() -> list[dict]:
    if not _TEMPLATE_CACHE.is_file():
        return []
    try:
        data = json.loads(_TEMPLATE_CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    tasks = data.get("tasks") if isinstance(data, dict) else None
    return [item for item in tasks or [] if isinstance(item, dict) and str(item.get("name") or "").strip()]


def save_template_outline(tasks: list[dict], *, fio: str) -> dict:
    from app.services.external_orders import ExternalOrderError

    rows: list[dict] = []
    for item in tasks or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        rows.append(
            {
                "name": name[:255],
                "level": max(int(item.get("level") or 1), 1),
                "duration_days": max(float(item.get("duration_days") or 0), 0.0),
                "milestone": bool(item.get("milestone")),
                "summary": bool(item.get("summary")),
                "resource": str(item.get("resource") or "").strip()[:255],
            }
        )
    if not rows:
        raise ExternalOrderError("В выгрузке шаблона нет задач", 400)
    _TEMPLATE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "template": TEMPLATE_NAME,
        "saved_by": fio,
        "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tasks": rows,
    }
    _TEMPLATE_CACHE.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True, "count": len(rows)}


def _match_key(name: str) -> str:
    folded = name.casefold()
    for key, words in _KEYWORDS:
        if any(word in folded for word in words):
            return key
    return ""


def _resource_for(name: str) -> str:
    folded = name.casefold()
    for key, label in RESOURCES.items():
        if folded and (folded == label.casefold() or folded in label.casefold() or label.casefold() in folded):
            return key
    return ""


def _outline(order: ExternalOrder, signed: bool) -> tuple[list[dict], str]:
    template = load_template_outline()
    rows: list[dict] = []
    if template:
        used: set[str] = set()
        for index, item in enumerate(template):
            name = str(item["name"]).strip()
            summary = bool(item.get("summary"))
            key = "" if summary else _match_key(name)
            if key in used:
                key = ""
            if key:
                used.add(key)
            builtin = next((row for row in _BUILTIN if row[0] == key), None)
            milestone = key in _EVENT_KEYS if key else bool(item.get("milestone"))
            resource = _resource_for(str(item.get("resource") or "")) or (builtin[4] if builtin else "")
            rows.append(
                {
                    "key": key or f"t{index + 1}",
                    "name": name,
                    "level": int(item.get("level") or 1),
                    "summary": summary,
                    "milestone": milestone and not summary,
                    "resource": "" if summary else resource,
                    "norm": 0 if milestone else max(math.ceil(float(item.get("duration_days") or 0)), 1),
                }
            )
        return rows, "template"
    for key, name, level, milestone, resource, norm, before_sign in _BUILTIN:
        if before_sign and signed:
            continue
        if key == "psi" and not _psi_applies(order):
            continue
        rows.append(
            {
                "key": key,
                "name": name,
                "level": level,
                "summary": not resource,
                "milestone": milestone,
                "resource": resource,
                "norm": norm,
            }
        )
    return rows, "builtin"


def _wbs(rows: list[dict]) -> None:
    counters: list[int] = []
    for row in rows:
        level = row["level"]
        if level <= 0:
            row["wbs"] = "0"
            continue
        while len(counters) < level:
            counters.append(0)
        del counters[level:]
        counters[level - 1] += 1
        row["wbs"] = ".".join(str(item) for item in counters)


def _durations(order: ExternalOrder, rows: list[dict], term_days: int) -> None:
    sections = _sections(order)
    for row in rows:
        row["source"] = ""
        if row["summary"] or row["milestone"]:
            row["duration_days"] = 0
            continue
        section, field = _SECTION_DAYS.get(row["key"], ("", ""))
        value = sections.get(section, {}).get(field) if isinstance(sections.get(section), dict) else ""
        days = _days_in(str(value or "")) if section else 0
        if days:
            row["duration_days"] = days
            row["source"] = "дело"
        else:
            row["duration_days"] = row["norm"]
            row["source"] = "норматив"
    run = [row for row in rows if row["key"] in _RUN_KEYS and row["source"] == "норматив"]
    if not term_days or not run:
        return
    fixed = sum(row["duration_days"] for row in rows if row["key"] in _RUN_KEYS and row["source"] == "дело")
    left = max(term_days - fixed, len(run))
    total = sum(row["duration_days"] for row in run) or 1
    for row in run:
        row["duration_days"] = max(round(row["duration_days"] * left / total), 1)
        row["source"] = "дело"
        row["term_note"] = f"распределено по сроку договора {term_days} раб. дн."
    drift = left - sum(row["duration_days"] for row in run)
    run[-1]["duration_days"] = max(run[-1]["duration_days"] + drift, 1)


def _apply_overrides(rows: list[dict], overrides: dict) -> None:
    for row in rows:
        change = overrides.get(row["key"]) if isinstance(overrides, dict) else None
        if not isinstance(change, dict):
            continue
        if not row["summary"] and "resource" in change:
            resource = str(change.get("resource") or "")
            if resource == "" or resource in RESOURCES:
                row["resource"] = resource
        if not row["summary"] and not row["milestone"] and change.get("duration_days") not in (None, ""):
            try:
                row["duration_days"] = max(int(math.ceil(float(change["duration_days"]))), 1)
            except (TypeError, ValueError):
                continue
            row["source"] = "вручную"
            row.pop("term_note", None)


def _schedule_rows(rows: list[dict], start: date) -> None:
    cursor = cal.at_start(start)
    previous = 0
    for row in rows:
        if row["summary"]:
            row["predecessors"] = []
            continue
        row["predecessors"] = [previous] if previous else []
        if row["milestone"]:
            row["start_at"] = row["finish_at"] = cursor if not previous else row_finish
        else:
            begin = cursor if not previous else cal.at_start(cal.after_working(row_finish.date()))
            if previous and row_finish.time() < cal.DAY_FINISH:
                begin = cal.at_start(cal.next_working(row_finish.date()))
            row["start_at"] = begin
            row["finish_at"] = cal.at_finish(cal.add_working_days(begin.date(), row["duration_days"]))
        row_finish = row["finish_at"]
        previous = row["uid"]
    _summaries(rows)


def _span(row: dict) -> int:
    if row["finish_at"] <= row["start_at"]:
        return 0
    return cal.working_days_between(row["start_at"].date(), row["finish_at"].date())


def _summaries(rows: list[dict]) -> None:
    for index, row in enumerate(rows):
        if not row["summary"]:
            continue
        children = []
        for child in rows[index + 1:]:
            if child["level"] <= row["level"]:
                break
            if "start_at" in child:
                children.append(child)
        if not children:
            row["start_at"] = row["finish_at"] = rows[0].get("start_at") or cal.at_start(date.today())
            continue
        row["start_at"] = min(child["start_at"] for child in children)
        row["finish_at"] = max(child["finish_at"] for child in children)


def plan_model(
    order: ExternalOrder,
    *,
    overrides: dict | None = None,
    start: str = "",
) -> dict:
    from app.services.external_orders import PROJECT_PLAN_TEMPLATE

    signed_on = _signed_on(order)
    signed = order.status in _SIGNED_STATUSES
    conditions = contract_conditions(order)
    term_text = next((item["value"] for item in conditions if item["key"] == "term" and item["value"] != _MISSING), "")
    term_days = _days_in(term_text)
    term_date = _date_in(term_text)
    first = _date_in(start) if start else None
    first = cal.next_working(first or signed_on or datetime.now(timezone.utc).date())

    rows, outline_source = _outline(order, signed)
    title = f"План работ {order.code}".strip()
    rows.insert(0, {"key": "root", "name": title, "level": 0, "summary": True, "milestone": False, "resource": "", "norm": 0})
    _durations(order, rows, term_days)
    _apply_overrides(rows, overrides or {})
    payments = [
        f"{item.get('percent') or '—'}% {item.get('date') or ''}".strip() for item in _schedule(order)
    ]
    for row in rows:
        if row["key"] == "pay":
            row["notes"] = ("График оплаты 1С: " + "; ".join(payments)) if payments else "Графика оплаты в деле нет"
    number = contract_number(order)
    contract_note = f"Договор: {number}" if number else "Номер договора в деле не указан"
    rows.append(
        {
            "key": "conditions",
            "name": "Условия договора",
            "level": 1,
            "summary": True,
            "milestone": False,
            "resource": "",
            "norm": 0,
            "duration_days": 0,
            "source": "",
            "notes": contract_note,
        }
    )
    for uid, row in enumerate(rows):
        row["uid"] = uid
    _schedule_rows([row for row in rows if row["key"] != "conditions"], first)
    contract_at = next((row["start_at"] for row in rows if row["key"] == "contract"), cal.at_start(first))
    for item in conditions:
        rows.append(
            {
                "uid": len(rows),
                "key": f"cond_{item['key']}",
                "name": item["label"],
                "level": 2,
                "summary": False,
                "milestone": False,
                "resource": "ks",
                "norm": 0,
                "duration_days": 0,
                "source": "дело" if item["value"] != _MISSING else "",
                "notes": item["value"],
                "predecessors": [],
                "start_at": contract_at,
                "finish_at": contract_at,
            }
        )
    _summaries(rows)
    _wbs(rows)

    work = [row for row in rows if row["key"] != "root"]
    header = (
        f"Черновик плана работ. Общий шаблон «{TEMPLATE_NAME}» не изменялся. {contract_note}"
    )
    rows[0]["notes"] = header
    finish = max(row["finish_at"] for row in rows)
    warnings = _warnings(rows, conditions, number=number, term_date=term_date, outline_source=outline_source)
    tasks = []
    for row in rows:
        group = "root" if row["key"] == "root" else ("conditions" if row["key"] == "conditions" or row["key"].startswith("cond_") else "work")
        notes = row.get("notes") or row.get("term_note") or ""
        tasks.append(
            {
                "uid": row["uid"],
                "key": row["key"],
                "wbs": row["wbs"],
                "name": row["name"],
                "level": row["level"],
                "summary": row["summary"],
                "milestone": row["milestone"],
                "duration_days": row["duration_days"] if not row["summary"] else _span(row),
                "start": row["start_at"].strftime("%Y-%m-%dT%H:%M:%S"),
                "finish": row["finish_at"].strftime("%Y-%m-%dT%H:%M:%S"),
                "predecessors": row.get("predecessors") or [],
                "resource": row["resource"],
                "resource_name": RESOURCES.get(row["resource"], ""),
                "source": row.get("source") or "",
                "group": group,
                "notes": notes,
                "editable": group == "work" and not row["summary"],
            }
        )
    holidays, working = cal.exceptions(first, finish.date())
    missing = [item["label"] for item in conditions if item["value"] == _MISSING]
    used = sorted({row["resource"] for row in work if row["resource"]}, key=list(RESOURCES).index)
    summary = (
        f"{title}: {cal.at_start(first):%d.%m.%Y} – {finish:%d.%m.%Y}, задач {len([t for t in tasks if not t['summary']])}. "
        + (f"Срок договора: {term_text}. " if term_text else "Срока договора в деле нет. ")
        + (f"В договоре дела нет: {', '.join(missing)}. " if missing else "")
        + "Черновик фактом не является."
    )
    return {
        "ok": True,
        "order_id": order.id,
        "code": order.code,
        "title": title,
        "customer": order.customer,
        "product": order.product,
        "start": first.isoformat(),
        "finish": finish.date().isoformat(),
        "contract_number": number,
        "template_path": PROJECT_PLAN_TEMPLATE,
        "outline_source": outline_source,
        "calendar": {
            "holidays": [item.isoformat() for item in holidays],
            "working_weekends": [item.isoformat() for item in working],
        },
        "resources": [{"key": key, "name": RESOURCES[key]} for key in (used or list(RESOURCES))],
        "all_resources": [{"key": key, "name": name} for key, name in RESOURCES.items()],
        "tasks": tasks,
        "conditions": [
            {"key": item["key"], "label": item["label"], "value": item["value"], "missing": item["value"] == _MISSING}
            for item in conditions
        ],
        "warnings": warnings,
        "summary": summary,
    }


def _warnings(
    rows: list[dict],
    conditions: list[dict[str, str]],
    *,
    number: str,
    term_date: date | None,
    outline_source: str,
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if outline_source != "template":
        out.append(
            {
                "code": "template_missing",
                "level": "warn",
                "text": f"Структура «{TEMPLATE_NAME}» не выгружена, взят встроенный состав задач",
            }
        )
    if not number:
        out.append({"code": "no_contract_number", "level": "warn", "text": "Номер договора в деле не указан"})
    for item in conditions:
        if item["value"] == _MISSING:
            level = "stop" if item["key"] in {"price", "term", "payment"} else "warn"
            out.append(
                {
                    "code": "condition_missing",
                    "level": level,
                    "key": f"cond_{item['key']}",
                    "text": f"Условие «{item['label']}»: в договоре дела нет",
                }
            )
    for row in rows:
        if row["key"] == "root" or row["summary"]:
            continue
        for moment in (row["start_at"], row["finish_at"]):
            if not cal.is_working(moment.date()):
                out.append(
                    {
                        "code": "weekend",
                        "level": "stop",
                        "key": row["key"],
                        "text": f"«{row['name']}» попадает на нерабочий день {moment:%d.%m.%Y}",
                    }
                )
                break
        if row["key"].startswith("cond_"):
            continue
        if not row["resource"]:
            out.append({"code": "no_resource", "level": "warn", "key": row["key"], "text": f"«{row['name']}» без службы"})
        if row.get("source") == "норматив":
            out.append(
                {
                    "code": "norm_duration",
                    "level": "warn",
                    "key": row["key"],
                    "text": f"«{row['name']}»: срок по нормативу {row['duration_days']} раб. дн., в деле срока нет",
                }
            )
    if term_date:
        ship = next((row for row in rows if row["key"] == "ship"), None)
        last = ship or max((row for row in rows if not row["summary"] and not row["key"].startswith("cond_")), key=lambda item: item["finish_at"], default=None)
        if last and last["finish_at"].date() > term_date:
            out.append(
                {
                    "code": "over_term",
                    "level": "stop",
                    "key": last["key"],
                    "text": f"«{last['name']}» {last['finish_at']:%d.%m.%Y} позже срока договора {term_date:%d.%m.%Y}",
                }
            )
    return out


def _hours(days: float) -> str:
    return f"PT{int(round(days * 8))}H0M0S"


def plan_xml(model: dict) -> bytes:
    # Project открывает файл только с пространством имён по умолчанию, без приставки ns0.
    ET.register_namespace("", _NS)
    root = ET.Element(_tag("Project"))
    tasks_data = model["tasks"]
    _text(root, "SaveVersion", "14")
    _text(root, "Name", model["title"])
    _text(root, "Title", f"{model['title']}. {model.get('customer', '')}. {model.get('product', '')}".strip(" ."))
    _text(root, "ScheduleFromStart", "1")
    _text(root, "StartDate", f"{model['start']}T08:00:00")
    _text(root, "FinishDate", max(item["finish"] for item in tasks_data))
    _text(root, "FYStartDate", "1")
    _text(root, "CriticalSlackLimit", "0")
    _text(root, "CurrencyDigits", "2")
    _text(root, "CurrencySymbol", "р.")
    _text(root, "CurrencyCode", "RUB")
    _text(root, "CurrencySymbolPosition", "3")
    _text(root, "CalendarUID", "1")
    _text(root, "DefaultStartTime", "08:00:00")
    _text(root, "DefaultFinishTime", "17:00:00")
    _text(root, "MinutesPerDay", "480")
    _text(root, "MinutesPerWeek", "2400")
    _text(root, "DaysPerMonth", "20")
    _text(root, "DefaultTaskType", "0")
    _text(root, "DurationFormat", "7")
    _text(root, "WorkFormat", "2")
    _text(root, "NewTasksEstimated", "0")
    tasks = ET.SubElement(root, _tag("Tasks"))
    project_start = f"{model['start']}T08:00:00"
    for item in tasks_data:
        node = ET.SubElement(tasks, _tag("Task"))
        _text(node, "UID", str(item["uid"]))
        _text(node, "ID", str(item["uid"]))
        _text(node, "Name", item["name"])
        _text(node, "Type", "1")
        _text(node, "IsNull", "0")
        _text(node, "WBS", item["wbs"])
        _text(node, "OutlineNumber", item["wbs"])
        _text(node, "OutlineLevel", str(item["level"]))
        _text(node, "Priority", "500")
        _text(node, "Start", item["start"])
        _text(node, "Finish", item["finish"])
        _text(node, "Duration", _hours(item["duration_days"]))
        _text(node, "DurationFormat", "7")
        _text(node, "Manual", "0")
        _text(node, "Estimated", "0")
        if not item["summary"] and not item["predecessors"] and item["start"] != project_start:
            _text(node, "ConstraintType", "4")
            _text(node, "ConstraintDate", item["start"])
        else:
            _text(node, "ConstraintType", "0")
        _text(node, "CalendarUID", "-1")
        _text(node, "Summary", "1" if item["summary"] else "0")
        _text(node, "Milestone", "1" if item["milestone"] else "0")
        if item.get("notes"):
            _text(node, "Notes", item["notes"])
        for predecessor in item["predecessors"]:
            link = ET.SubElement(node, _tag("PredecessorLink"))
            _text(link, "PredecessorUID", str(predecessor))
            _text(link, "Type", "1")
            _text(link, "CrossProject", "0")
            _text(link, "LinkLag", "0")
            _text(link, "LagFormat", "7")
    _calendar(root, model["calendar"])
    resources = ET.SubElement(root, _tag("Resources"))
    resource_uid: dict[str, int] = {}
    for index, item in enumerate(model["resources"], start=1):
        resource_uid[item["key"]] = index
        node = ET.SubElement(resources, _tag("Resource"))
        _text(node, "UID", str(index))
        _text(node, "ID", str(index))
        _text(node, "Name", item["name"])
        _text(node, "Type", "1")
        _text(node, "IsNull", "0")
        _text(node, "MaxUnits", "1.00")
        _text(node, "CalendarUID", "1")
    assignments = ET.SubElement(root, _tag("Assignments"))
    number = 0
    for item in tasks_data:
        uid = resource_uid.get(item["resource"])
        if not uid or item["summary"]:
            continue
        number += 1
        node = ET.SubElement(assignments, _tag("Assignment"))
        _text(node, "UID", str(number))
        _text(node, "TaskUID", str(item["uid"]))
        _text(node, "ResourceUID", str(uid))
        _text(node, "Units", "1")
        _text(node, "Work", _hours(item["duration_days"]))
        _text(node, "Start", item["start"])
        _text(node, "Finish", item["finish"])
    raw = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    text = raw.decode("utf-8").replace("ns0:", "").replace('xmlns:ns0=', 'xmlns=')
    return text.encode("utf-8")


def _calendar(root: ET.Element, calendar: dict) -> None:
    calendars = ET.SubElement(root, _tag("Calendars"))
    node = ET.SubElement(calendars, _tag("Calendar"))
    _text(node, "UID", "1")
    _text(node, "Name", "Производственный РФ")
    _text(node, "IsBaseCalendar", "1")
    _text(node, "BaseCalendarUID", "-1")
    days = ET.SubElement(node, _tag("WeekDays"))
    for day_type in range(1, 8):
        day = ET.SubElement(days, _tag("WeekDay"))
        _text(day, "DayType", str(day_type))
        working = day_type not in {1, 7}
        _text(day, "DayWorking", "1" if working else "0")
        if working:
            _working_times(day)
    found = [(item, False) for item in calendar.get("holidays") or []] + [
        (item, True) for item in calendar.get("working_weekends") or []
    ]
    if not found:
        return
    exceptions = ET.SubElement(node, _tag("Exceptions"))
    for value, working in sorted(found):
        item = ET.SubElement(exceptions, _tag("Exception"))
        _text(item, "EnteredByOccurrences", "0")
        period = ET.SubElement(item, _tag("TimePeriod"))
        _text(period, "FromDate", f"{value}T00:00:00")
        _text(period, "ToDate", f"{value}T23:59:00")
        _text(item, "Occurrences", "1")
        _text(item, "Name", "Рабочий день по переносу" if working else "Праздник")
        _text(item, "Type", "1")
        _text(item, "DayWorking", "1" if working else "0")
        if working:
            _working_times(item)


def _working_times(parent: ET.Element) -> None:
    times = ET.SubElement(parent, _tag("WorkingTimes"))
    for begin, end in (("08:00:00", "12:00:00"), ("13:00:00", "17:00:00")):
        slot = ET.SubElement(times, _tag("WorkingTime"))
        _text(slot, "FromTime", begin)
        _text(slot, "ToTime", end)


def _safe_name(code: str, suffix: str = ".xml") -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in " ._-" else "_" for ch in (code or "заказ"))
    return f"План работ {cleaned.strip() or 'заказ'}{suffix}"


def _drop_drafts(order: ExternalOrder, suffix: str) -> None:
    """Снимает незатверждённый черновик того же формата. XML и .mpp живут рядом."""
    wanted = (suffix or "").casefold()
    if not wanted:
        return
    for doc in [item for item in order.documents if item.kind == _PLAN_KIND and not item.approved]:
        if not (doc.file_name or "").casefold().endswith(wanted):
            continue
        path = Path(doc.stored_path) if doc.stored_path else None
        if path and path.is_file():
            path.unlink()
        order.documents.remove(doc)


def _store(db: Session, order: ExternalOrder, *, raw: bytes, filename: str, mime: str, note: str) -> str:
    _drop_drafts(order, Path(filename).suffix)
    doc_id = uuid4().hex
    folder = BACKEND_ROOT / "storage" / "external_orders" / order.id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{doc_id}_{filename}"
    path.write_bytes(raw)
    db.add(
        ExternalOrderDocument(
            id=doc_id,
            order_id=order.id,
            kind=_PLAN_KIND,
            title=f"План работ {order.code}",
            version="v1",
            note=note,
            file_name=filename,
            stored_path=str(path),
            mime=mime,
            sha256="",
            owner_role="production",
        )
    )
    return doc_id


def build_work_plan(
    db: Session,
    order_id: str,
    *,
    fio: str,
    overrides: dict | None = None,
    start: str = "",
) -> dict:
    from app.services.external_orders import _audit, _order

    order = _order(db, order_id)
    model = plan_model(order, overrides=overrides, start=start)
    filename = _safe_name(order.code)
    doc_id = _store(
        db,
        order,
        raw=plan_xml(model),
        filename=filename,
        mime=_MIME,
        note="Черновик XML для Project. Условия договора включены в задачи. Фактом не является, пока человек не утвердит.",
    )
    _audit(db, order, fio=fio or "агент", role="production", action="plan_file", detail=filename)
    db.commit()
    missing = [item["label"] for item in model["conditions"] if item["missing"]]
    filled = [f"{item['label']}: {item['value']}" for item in model["conditions"] if not item["missing"]]
    parts = [f"План работ {order.code} записан в дело: {filename}."]
    parts.append(f"Сроки {datetime.fromisoformat(model['start']):%d.%m.%Y} – {datetime.fromisoformat(model['finish']):%d.%m.%Y} по производственному календарю.")
    parts.append("XML записан. Файл .mpp собирается на этом компьютере в том же ходе. Общий шаблон на диске не менялся.")
    if model["contract_number"]:
        parts.append(f"Договор {model['contract_number']}.")
    if filled:
        parts.append("Условия из дела: " + "; ".join(filled) + ".")
    if missing:
        parts.append("В договоре дела нет: " + ", ".join(missing) + ".")
    parts.append("Черновик фактом не является.")
    return {
        "ok": True,
        "summary": " ".join(parts),
        "note": "Файл уже в файлах дела. Другого инструмента сохранения нет. Назови file_name и остановись.",
        "order_id": order.id,
        "file_name": filename,
        "document_id": doc_id,
        "missing": missing,
        "warnings": model["warnings"],
        "model": model,
    }


def preview_work_plan(db: Session, order_id: str, *, overrides: dict | None = None, start: str = "") -> dict:
    from app.services.external_orders import _order

    return plan_model(_order(db, order_id), overrides=overrides, start=start)


def store_mpp(db: Session, order_id: str, *, fio: str, role: str, filename: str, content_b64: str) -> None:
    from app.services.external_orders import ExternalOrderError, _audit, _order

    if role == "viewer":
        raise ExternalOrderError("Просмотр не меняет дело", 403)
    order = _order(db, order_id)
    try:
        raw = base64.b64decode(content_b64 or "", validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ExternalOrderError("Файл .mpp повреждён", 400) from exc
    if len(raw) < 512:
        raise ExternalOrderError("Файл .mpp пустой", 400)
    if not raw.startswith(b"\xd0\xcf\x11\xe0"):
        raise ExternalOrderError("Это не файл Project (.mpp)", 400)
    name = Path(filename or "").name or _safe_name(order.code, ".mpp")
    if not name.casefold().endswith(".mpp"):
        name = f"{Path(name).stem}.mpp"
    _store(
        db,
        order,
        raw=raw,
        filename=name,
        mime=_MPP_MIME,
        note=f"Черновик .mpp, собран в Project по шаблону «{TEMPLATE_NAME}». Фактом не является, пока человек не утвердит.",
    )
    _audit(db, order, fio=fio or "агент", role=role or "production", action="plan_file", detail=name)


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


def file_mime(path: Path) -> str:
    return _MPP_MIME if path.suffix.casefold() == ".mpp" else _MIME
