"""Чтение внешнего заказа из 1С ERP: контрагент, заказ клиента, договор, безналичная оплата.

Факт оплаты не вводится руками. Процент для закрытия считается по поступлениям,
привязанным к объекту расчётов заказа. Запись в 1С этот модуль не делает.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.services.docflow_document_create import DocumentCreateError, _ODataClient, _quote

_GUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_EMPTY = "00000000-0000-0000-0000-000000000000"
_ORDER = "Document_ЗаказКлиента"
_PAY = "Document_ПоступлениеБезналичныхДенежныхСредств_РасшифровкаПлатежа"
_CONTRACTOR = "Catalog_Контрагенты"
_CONTRACT = "Catalog_ДоговорыКонтрагентов"


class OnecLinkError(Exception):
    def __init__(self, detail: str, status: int = 502) -> None:
        self.detail = detail
        self.status = status


def connection_label() -> tuple[str, str]:
    from app.services.onec_tools import odata_configured

    if not odata_configured():
        return (
            "не настроено",
            "В backend нет адреса или учётной записи OData ERP.",
        )
    return (
        "подключено",
        "Контрагенты, заказы клиента, договоры и безналичная оплата читаются из ERP. "
        "Процент оплаты для закрытия считается по поступлениям заказа.",
    )


def _client() -> _ODataClient:
    from app.config import settings
    from app.services.onec_tools import _odata_auth, odata_configured

    if not odata_configured():
        raise OnecLinkError("1С ERP не настроена: нет адреса OData или учётной записи", 503)
    base = (settings.odata_base_url or "").strip()
    auth = _odata_auth({})
    if not base or not auth:
        raise OnecLinkError("1С ERP не настроена: нет адреса OData или учётной записи", 503)
    return _ODataClient(base, auth, label="ERP", validate=True)


def _rows(
    client: _ODataClient,
    entity: str,
    *,
    filt: str = "",
    top: int = 20,
    ref_key: str = "",
    orderby: str = "",
) -> list[dict]:
    try:
        return client.get(entity, filt=filt, top=top, ref_key=ref_key, orderby=orderby)
    except DocumentCreateError as exc:
        raise OnecLinkError(str(exc), 502) from exc


def _guid(value: str, label: str) -> str:
    text = (value or "").strip()
    if not _GUID.match(text) or text == _EMPTY:
        raise OnecLinkError(f"В 1С нет ссылки: {label}", 400)
    return text


def _money(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _percent(paid: float, amount: float) -> int:
    if amount <= 0 or paid <= 0:
        return 0
    return max(0, min(100, int(round(paid / amount * 100))))


def _name(row: dict) -> str:
    return str(row.get("Description") or row.get("Number") or "").strip()


def recent_orders(top: int = 25) -> dict:
    """Последние проведённые заказы клиента. Имена контрагентов здесь не читаются: карточка подтянет их при загрузке."""
    client = _client()
    try:
        rows = _rows(
            client,
            _ORDER,
            filt="DeletionMark eq false and Posted eq true",
            top=top,
            orderby="Date desc",
        )
    except OnecLinkError:
        rows = _rows(client, _ORDER, filt="DeletionMark eq false", top=top)
    orders = [_order_hit(row) for row in rows if str(row.get("Ref_Key") or "").strip()]
    orders.sort(key=lambda item: item.get("date") or "", reverse=True)
    return {"configured": True, "counterparties": [], "orders": orders}


def search(query: str = "", counterparty_key: str = "") -> dict:
    client = _client()
    text = " ".join((query or "").split())[:80]
    party = (counterparty_key or "").strip()
    counterparties: list[dict[str, str]] = []
    orders: list[dict[str, str]] = []
    if party:
        party = _guid(party, "контрагент")
        rows = _rows(
            client,
            _ORDER,
            filt=f"DeletionMark eq false and Контрагент_Key eq guid'{party}'",
            top=15,
        )
        orders = [_order_hit(row) for row in rows]
    elif text:
        if text.isdigit() and len(text) in {10, 12}:
            party_filter = f"DeletionMark eq false and ИНН eq '{_quote(text)}'"
        else:
            party_filter = f"DeletionMark eq false and substringof('{_quote(text)}', Description)"
        for row in _rows(client, _CONTRACTOR, filt=party_filter, top=8):
            if row.get("IsFolder"):
                continue
            name = _name(row)
            key = str(row.get("Ref_Key") or "")
            if not name or not key:
                continue
            counterparties.append({"key": key, "name": name, "inn": str(row.get("ИНН") or "").strip()})
        rows = _rows(
            client,
            _ORDER,
            filt=f"DeletionMark eq false and substringof('{_quote(text)}', Number)",
            top=8,
        )
        orders = [_order_hit(row) for row in rows]
    orders.sort(key=lambda item: item.get("date") or "", reverse=True)
    return {"configured": True, "counterparties": counterparties, "orders": orders}


def _order_hit(row: dict) -> dict[str, str]:
    amount = _money(row.get("СуммаДокумента"))
    return {
        "key": str(row.get("Ref_Key") or ""),
        "number": str(row.get("Number") or "").strip(),
        "date": str(row.get("Date") or "")[:10],
        "amount": f"{amount:.2f}",
    }


def read_order(ref_key: str) -> dict[str, str]:
    client = _client()
    key = _guid(ref_key, "заказ клиента")
    rows = _rows(client, _ORDER, ref_key=key)
    row = rows[0] if rows else None
    if not row or row.get("DeletionMark"):
        raise OnecLinkError("Заказ клиента в 1С не найден", 404)
    amount = _money(row.get("СуммаДокумента"))
    settlement = str(row.get("ОбъектРасчетов_Key") or "")
    paid = _paid(client, settlement)
    party_key = str(row.get("Контрагент_Key") or "")
    contract_key = str(row.get("Договор_Key") or "")
    party = _catalog(client, _CONTRACTOR, party_key)
    contract = _catalog(client, _CONTRACT, contract_key)
    percent = _percent(paid, amount)
    return {
        "order_key": key,
        "order_number": str(row.get("Number") or "").strip(),
        "order_date": str(row.get("Date") or "")[:10],
        "amount": f"{amount:.2f}",
        "paid": f"{paid:.2f}",
        "payment_percent": str(percent),
        "counterparty_key": party_key if party_key != _EMPTY else "",
        "counterparty": party.get("name") or "",
        "inn": party.get("inn") or "",
        "contract_key": contract_key if contract_key != _EMPTY else "",
        "contract": contract.get("name") or "",
    }


def _catalog(client: _ODataClient, entity: str, ref_key: str) -> dict[str, str]:
    if not _GUID.match(ref_key or "") or ref_key == _EMPTY:
        return {}
    rows = _rows(client, entity, ref_key=ref_key)
    row = rows[0] if rows else {}
    return {"name": _name(row), "inn": str(row.get("ИНН") or "").strip()}


_DEAL = "Catalog_СделкиСКлиентами"
_DEAL_STATUS = {"ВРаботе": "В работе", "Выиграна": "Выиграна", "Проиграна": "Проиграна"}
_TKP = "Document_КоммерческоеПредложениеКлиенту"
_SALE = "Document_РеализацияТоваровУслуг"
_PROD = "Document_ЗаказНаПроизводство2_2"
_STATUS_LABELS = {
    "НеСогласовано": "Не согласовано",
    "Согласовано": "Согласовано",
    "Действует": "Действует",
    "Исполнено": "Исполнено",
    "КОбеспечению": "К обеспечению",
    "КВыполнению": "К выполнению",
    "НаСогласовании": "На согласовании",
    "Закрыт": "Закрыт",
    "Отгружено": "Отгружено",
}


def status_label(value: str) -> str:
    text = (value or "").strip()
    return _STATUS_LABELS.get(text, text)


def recent_tkp(top: int = 20) -> dict:
    """Проведённые коммерческие предложения. С них в ERP начинается путь заказа."""
    client = _client()
    try:
        rows = _rows(
            client,
            _TKP,
            filt="DeletionMark eq false and Posted eq true",
            top=top,
            orderby="Date desc",
        )
    except OnecLinkError:
        rows = _rows(client, _TKP, filt="DeletionMark eq false", top=top, orderby="Date desc")
    orders = []
    for row in rows:
        key = str(row.get("Ref_Key") or "").strip()
        if not key:
            continue
        order_key = str(row.get("ЗаказКлиента_Key") or "")
        amount = _money(row.get("СуммаДокументаТКП") or row.get("СуммаДокумента"))
        status = str(row.get("Статус") or "").strip()
        orders.append(
            {
                "key": key,
                "number": str(row.get("Number") or "").strip(),
                "date": str(row.get("Date") or "")[:10],
                "amount": f"{amount:.2f}",
                "status": status_label(status),
                "has_order": "1" if order_key and order_key != _EMPTY else "",
            }
        )
    return {"configured": True, "counterparties": [], "orders": orders}


def trace_tkp(ref_key: str) -> dict[str, str]:
    """Путь одного ТКП: предложение, заказ клиента, договор, производство, отгрузка, оплата."""
    client = _client()
    key = _guid(ref_key, "ТКП")
    rows = _rows(client, _TKP, ref_key=key)
    row = rows[0] if rows else None
    if not row or row.get("DeletionMark"):
        raise OnecLinkError("Коммерческое предложение в 1С не найдено", 404)
    order_key = _optional_guid(str(row.get("ЗаказКлиента_Key") or ""))
    contract_key = _optional_guid(str(row.get("ДоговорКонтрагента_Key") or ""))
    party_key = _optional_guid(str(row.get("Контрагент_Key") or ""))
    order = _document(client, _ORDER, order_key) if order_key else {}
    if not contract_key:
        contract_key = _optional_guid(str(order.get("Договор_Key") or ""))
    if not party_key:
        party_key = _optional_guid(str(order.get("Контрагент_Key") or ""))
    party = _catalog(client, _CONTRACTOR, party_key)
    contract = _contract(client, contract_key)
    sales = _children(client, _SALE, "ЗаказКлиента", order_key) if order_key else []
    production = _children(client, _PROD, "ДокументОснование", order_key) if order_key else []
    deal = _deal(client, order, row)
    schedule = _schedule(order)
    amount = _money(order.get("СуммаДокумента") or row.get("СуммаДокумента"))
    paid = _paid(client, str(order.get("ОбъектРасчетов_Key") or "")) if order else 0.0
    percent = _percent(paid, amount)
    tkp_status = str(row.get("Статус") or "").strip()
    order_status = str(order.get("Статус") or "").strip()
    steps = _steps(
        tkp_number=str(row.get("Number") or "").strip(),
        tkp_status=status_label(tkp_status),
        order_number=str(order.get("Number") or "").strip(),
        order_status=status_label(order_status),
        contract_number=contract.get("number") or "",
        contract_name=contract.get("name") or "",
        production=production,
        sales=sales,
        percent=percent,
        deal_name=deal.get("deal_name") or "",
        deal_status=deal.get("deal_status") or "",
        lines_count=len(order.get("Товары") or []) if isinstance(order.get("Товары"), list) else 0,
        schedule_count=len(schedule),
    )
    stage, status = _stage_for(steps, tkp_status=tkp_status, percent=percent)
    comment = str(row.get("Комментарий") or "").strip().splitlines()
    return {
        "tkp_key": key,
        "tkp_number": str(row.get("Number") or "").strip(),
        "tkp_date": str(row.get("Date") or "")[:10],
        "tkp_status": tkp_status,
        "tkp_status_label": status_label(tkp_status),
        "comment": (comment[0] if comment else "")[:180],
        "order_key": order_key,
        "order_number": str(order.get("Number") or "").strip(),
        "order_date": str(order.get("Date") or "")[:10],
        "order_status": status_label(order_status),
        "amount": f"{amount:.2f}",
        "paid": f"{paid:.2f}",
        "payment_percent": str(percent),
        "counterparty_key": party_key,
        "counterparty": party.get("name") or "",
        "inn": party.get("inn") or "",
        "contract_key": contract_key,
        "contract": contract.get("name") or "",
        "contract_number": contract.get("number") or "",
        "deal_key": deal.get("deal_key") or "",
        "deal_name": deal.get("deal_name") or "",
        "deal_status": deal.get("deal_status") or "",
        "deal_start": deal.get("deal_start") or "",
        "deal_finish": deal.get("deal_finish") or "",
        "lines_count": str(len(order.get("Товары") or []) if isinstance(order.get("Товары"), list) else 0),
        "schedule": json.dumps(schedule, ensure_ascii=False),
        "path": json.dumps(steps, ensure_ascii=False),
        "suggested_stage": stage,
        "suggested_status": status,
    }


def tkp_key_for_order(order_key: str) -> str:
    key = _optional_guid(order_key)
    if not key:
        return ""
    client = _client()
    try:
        rows = _rows(
            client,
            _TKP,
            filt=f"DeletionMark eq false and ЗаказКлиента_Key eq guid'{key}'",
            top=1,
            orderby="Date desc",
        )
    except OnecLinkError:
        return ""
    return str(rows[0].get("Ref_Key") or "") if rows else ""


def _optional_guid(value: str) -> str:
    text = (value or "").strip()
    if not _GUID.match(text) or text == _EMPTY:
        return ""
    return text


def _document(client: _ODataClient, entity: str, ref_key: str) -> dict:
    if not ref_key:
        return {}
    rows = _rows(client, entity, ref_key=ref_key)
    row = rows[0] if rows else {}
    if row.get("DeletionMark"):
        return {}
    return row


def _contract(client: _ODataClient, ref_key: str) -> dict[str, str]:
    if not ref_key:
        return {}
    rows = _rows(client, _CONTRACT, ref_key=ref_key)
    row = rows[0] if rows else {}
    return {
        "name": _name(row),
        "number": str(row.get("Номер") or row.get("Number") or "").strip(),
    }


def _children(client: _ODataClient, entity: str, field: str, order_key: str) -> list[dict[str, str]]:
    if not order_key:
        return []
    cast = f"cast(guid'{order_key}', 'Document_ЗаказКлиента')"
    try:
        rows = _rows(
            client,
            entity,
            filt=f"DeletionMark eq false and {field} eq {cast}",
            top=8,
        )
    except OnecLinkError:
        return []
    items = []
    for row in rows:
        if row.get("Posted") is False:
            continue
        items.append(
            {
                "number": str(row.get("Number") or "").strip(),
                "date": str(row.get("Date") or "")[:10],
                "status": status_label(str(row.get("Статус") or "")),
            }
        )
    return items


def _deal(client: _ODataClient, order: dict, tkp: dict) -> dict[str, str]:
    key = _optional_guid(str(order.get("Сделка_Key") or tkp.get("Сделка_Key") or ""))
    if not key:
        return {}
    try:
        rows = _rows(client, _DEAL, ref_key=key)
    except OnecLinkError:
        return {}
    row = rows[0] if rows else {}
    status = str(row.get("Статус") or "").strip()
    return {
        "deal_key": key,
        "deal_name": _name(row),
        "deal_status": _DEAL_STATUS.get(status, status),
        "deal_start": str(row.get("ДатаНачала") or "")[:10],
        "deal_finish": str(row.get("ДатаОкончания") or "")[:10],
    }


def _schedule(order: dict) -> list[dict[str, str]]:
    rows = order.get("ЭтапыГрафикаОплаты") if isinstance(order.get("ЭтапыГрафикаОплаты"), list) else []
    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        items.append(
            {
                "date": str(row.get("ДатаПлатежа") or "")[:10],
                "percent": str(row.get("ПроцентПлатежа") or "").strip(),
                "option": str(row.get("ВариантОплаты") or "").strip(),
            }
        )
    return items


def _join_docs(rows: list[dict[str, str]]) -> str:
    parts = []
    for row in rows:
        text = row.get("number") or "без номера"
        if row.get("status"):
            text = f"{text}, {row['status']}"
        parts.append(text)
    return "; ".join(parts)


def _steps(
    *,
    tkp_number: str,
    tkp_status: str,
    order_number: str,
    order_status: str,
    contract_number: str,
    contract_name: str,
    production: list[dict[str, str]],
    sales: list[dict[str, str]],
    percent: int,
    deal_name: str = "",
    deal_status: str = "",
    lines_count: int = 0,
    schedule_count: int = 0,
) -> list[dict[str, str]]:
    contract_detail = " ".join(part for part in (contract_number, contract_name) if part).strip()
    order_detail = " · ".join(part for part in (order_number, order_status) if part)
    if lines_count:
        order_detail = f"{order_detail} · строк состава {lines_count}".strip(" ·")
    payment_detail = f"{percent}% по поступлениям заказа"
    if schedule_count:
        payment_detail = f"график {schedule_count} эт. · {payment_detail}"
    raw = [
        ("crm", "CRM", bool(deal_name), " · ".join(part for part in (deal_name, deal_status) if part)),
        ("tkp", "ТКП", True, " · ".join(part for part in (tkp_number, tkp_status) if part)),
        ("order", "Заказ клиента", bool(order_number), order_detail),
        ("contract", "Договор", bool(contract_detail), contract_detail),
        ("production", "Производство", bool(production), _join_docs(production) or "В 1С нет заказа на производство"),
        ("shipment", "Отгрузка", bool(sales), _join_docs(sales) or "Реализации ещё нет"),
        ("payment", "Оплата", percent >= 100, payment_detail),
    ]
    first_gap = next(
        (index for index, item in enumerate(raw) if item[0] not in {"production", "crm"} and not item[2]),
        None,
    )
    steps = []
    for index, (step_id, title, present, detail) in enumerate(raw):
        if step_id in {"production", "crm"} and not present:
            state = "skip"
        elif present:
            state = "done"
        elif first_gap == index:
            state = "current"
        else:
            state = "waiting"
        steps.append({"id": step_id, "title": title, "state": state, "detail": detail or "ещё нет в 1С"})
    return steps


def _stage_for(steps: list[dict[str, str]], *, tkp_status: str, percent: int) -> tuple[str, str]:
    current = next((item["id"] for item in steps if item["state"] == "current"), "")
    if not current and percent >= 100 and any(item["id"] == "shipment" and item["state"] == "done" for item in steps):
        return "payment", "closed"
    if current == "payment":
        return "payment", "awaiting_payment"
    if current == "shipment":
        return "execution", "in_progress"
    if current == "contract":
        return "contract", "contract_review"
    if current == "order":
        if tkp_status in {"Согласовано", "Действует", "Исполнено"}:
            return "tkp", "tkp_issued"
        return "calc", "calculating"
    if tkp_status in {"Согласовано", "Действует", "Исполнено"}:
        return "tkp", "tkp_issued"
    return "calc", "calculating"


def _paid(client: _ODataClient, settlement_key: str) -> float:
    if not _GUID.match(settlement_key or "") or settlement_key == _EMPTY:
        return 0.0
    rows = _rows(
        client,
        _PAY,
        filt=f"ОбъектРасчетов_Key eq guid'{settlement_key}'",
        top=200,
    )
    total = 0.0
    for row in rows:
        total += _money(row.get("СуммаВзаиморасчетов") or row.get("Сумма"))
    return total
