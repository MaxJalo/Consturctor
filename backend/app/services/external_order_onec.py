"""Чтение внешнего заказа из 1С ERP: контрагент, заказ клиента, договор, безналичная оплата.

Факт оплаты не вводится руками. Процент для закрытия считается по поступлениям,
привязанным к объекту расчётов заказа. Запись в 1С этот модуль не делает.
"""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
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
    skip: int = 0,
    select: str = "",
) -> list[dict]:
    try:
        return client.get(
            entity,
            filt=filt,
            top=top,
            ref_key=ref_key,
            orderby=orderby,
            skip=skip,
            select=select,
        )
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
        "comment": _plain(row.get("Комментарий"), 180),
        "product": _order_product(client, row),
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
_NOMEN = "Catalog_Номенклатура"
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


_PARTNER = "Catalog_Партнеры"
_ORG = "Catalog_Организации"
_USER = "Catalog_Пользователи"
_CURRENCY = "Catalog_Валюты"
_AGREEMENT = "Catalog_СоглашенияСКлиентами"
_ENUM = {
    "РеализацияКлиенту": "Реализация клиенту",
    "ЗакупкаУПоставщика": "Закупка у поставщика",
    "Безналичная": "Безналичная",
    "Наличная": "Наличная",
    "Самовывоз": "Самовывоз",
    "СиламиПеревозчикаПоАдресу": "Силами перевозчика по адресу",
    "СиламиПеревозчика": "Силами перевозчика",
    "ДоКлиента": "До клиента",
    "ПродажаОблагаетсяНДС": "Продажа облагается НДС",
    "ЭкспортНесырьевыхТоваров": "Экспорт несырьевых товаров",
    "ПродажаНеОблагаетсяНДС": "Продажа не облагается НДС",
    "УказываетсяВДняхСМоментаЗаказа": "В днях с момента заказа",
}


def _enum_label(value: str) -> str:
    text = (value or "").strip()
    if not text or text in {"0", "0001-01-01T00:00:00"}:
        return ""
    if text in _ENUM:
        return _ENUM[text]
    labeled = status_label(text)
    if labeled != text:
        return labeled
    split = re.sub(r"([a-zа-яё])([A-ZА-ЯЁ])", r"\1 \2", text)
    if split == text:
        return text
    return split[:1].upper() + split[1:].lower()


def _stamp(value: str, *, with_time: bool = False) -> str:
    text = (value or "").strip()
    if len(text) < 10 or text.startswith("0001"):
        return ""
    year, month, day = text[:10].split("-")
    shown = f"{day}.{month}.{year}"
    if with_time and len(text) >= 16 and text[11:16] != "00:00":
        shown += " " + text[11:16]
    return shown


def _money_text(value: Any) -> str:
    amount = _money(value)
    sign = "-" if amount < 0 else ""
    whole, frac = f"{abs(amount):.2f}".split(".")
    groups: list[str] = []
    while whole:
        groups.append(whole[-3:])
        whole = whole[:-3]
    return sign + " ".join(reversed(groups)) + "," + frac


def _yes(value: Any) -> str:
    return "да" if value is True else "нет"


def _titles(client: _ODataClient, entity: str, keys: set[str], *, number: bool = False) -> dict[str, str]:
    clean = [key for key in keys if _optional_guid(key)]
    found: dict[str, str] = {}
    select = "Ref_Key,Number" if number else "Ref_Key,Description"
    for start in range(0, len(clean), 40):
        chunk = clean[start : start + 40]
        filt = " or ".join(f"Ref_Key eq guid'{key}'" for key in chunk)
        try:
            rows = _rows(client, entity, filt=f"({filt})", top=len(chunk), select=select)
        except OnecLinkError:
            try:
                rows = _rows(client, entity, filt=f"({filt})", top=len(chunk))
            except OnecLinkError:
                continue
        for row in rows:
            ref = str(row.get("Ref_Key") or "")
            found[ref] = str(row.get("Number") or "").strip() if number else _name(row)
    return found


_TKP_PAGE = 200
_TKP_SELECT = (
    "Ref_Key,Number,Date,Партнер_Key,ПартнерКонечногоЗаказчика_Key,"
    "Контрагент_Key,КонтрагентКонечныйЗаказчик_Key,Сделка_Key,"
    "ДоговорКонтрагента_Key,ЗаказКлиента_Key,Организация_Key,Менеджер_Key,"
    "Соглашение_Key,Валюта_Key,СуммаДокументаТКП,СуммаДокумента,Статус,"
    "СрокДействия,СрокПоставки,ФормаОплаты,СпособДоставки,НалогообложениеНДС,"
    "Согласован,СогласованоСКлиентом,ХозяйственнаяОперация,Комментарий"
)


def _tkp_documents(client: _ODataClient, filt: str, limit: int) -> list[dict]:
    """Все строки фильтра, страницами. limit > 0 обрезает список."""
    found: list[dict] = []
    seen: set[str] = set()
    skip = 0
    select = _TKP_SELECT
    while True:
        room = _TKP_PAGE if limit <= 0 else min(_TKP_PAGE, limit - len(found))
        if room <= 0:
            break
        try:
            batch = _rows(
                client,
                _TKP,
                filt=filt,
                top=room,
                orderby="Date desc",
                skip=skip,
                select=select,
            )
        except OnecLinkError:
            if not select:
                raise
            select = ""
            skip = 0
            found = []
            seen = set()
            continue
        if not batch:
            break
        fresh = 0
        for row in batch:
            key = str(row.get("Ref_Key") or "").strip()
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            found.append(row)
            fresh += 1
        if fresh == 0 or len(batch) < room:
            break
        skip += len(batch)
    return found


def recent_tkp(top: int = 0) -> dict:
    """Проведённые коммерческие предложения, все страницы. top > 0 ограничивает число строк."""
    client = _client()
    try:
        rows = _tkp_documents(client, "DeletionMark eq false and Posted eq true", top)
    except OnecLinkError:
        rows = _tkp_documents(client, "DeletionMark eq false", top)
    rows = [row for row in rows if str(row.get("Ref_Key") or "").strip()]
    return {"configured": True, "counterparties": [], "orders": _tkp_rows(client, rows)}


def tkp_card(ref_key: str) -> dict[str, str]:
    """Одно ТКП теми же полями, что и строка импорта: условия для черновиков карточки."""
    key = _optional_guid(ref_key or "")
    if not key:
        return {}
    for _at, page in list(_tkp_pages.values()):
        for item in page.get("orders") or []:
            if item.get("key") == key:
                return dict(item)
    client = _client()
    rows = [row for row in _rows(client, _TKP, ref_key=key) if not row.get("DeletionMark")]
    found = _tkp_rows(client, rows)
    return found[0] if found else {}


def _plain(value: Any, limit: int = 180) -> str:
    return " ".join(str(value or "").split())[:limit]


def _text_query(
    client: _ODataClient,
    query: str,
    text_fields: list[str],
    party_fields: list[tuple[str, str]],
) -> str:
    """Фраза целиком или каждое слово в номере и комментарии, плюс контрагент по всей фразе."""
    phrase = " ".join((query or "").split())[:80]
    if not phrase:
        return ""
    words = [word for word in phrase.split() if len(word) >= 2][:4]
    options = [f"substringof('{_quote(phrase)}', {field})" for field in text_fields]
    for entity, field in party_fields:
        for key in _matching_keys(client, entity, phrase):
            options.append(f"{field} eq guid'{key}'")
    if len(words) > 1:
        groups = [
            "(" + " or ".join(f"substringof('{_quote(word)}', {field})" for field in text_fields) + ")"
            for word in words
        ]
        options.insert(0, " and ".join(groups))
    return "(" + " or ".join(options) + ")"


def _tkp_products(client: _ODataClient, keys: list[str]) -> dict[str, str]:
    """Предмет ТКП: текстовое описание строк, до трёх позиций."""
    found: dict[str, str] = {}
    for start in range(0, len(keys), 15):
        chunk = keys[start : start + 15]
        filt = " or ".join(f"Ref_Key eq guid'{key}'" for key in chunk)
        try:
            rows = _rows(client, _TKP, filt=f"({filt})", top=len(chunk), select="Ref_Key,Товары")
        except OnecLinkError:
            continue
        for row in rows:
            names: list[str] = []
            lines = [line for line in (row.get("Товары") or []) if isinstance(line, dict)]
            for line in lines:
                if line.get("CRM_ЭтоРазделитель"):
                    continue
                text = _plain(line.get("ТекстовоеОписание") or line.get("КомментарийДляПокупателя"), 120)
                if text and text not in names:
                    names.append(text)
                if len(names) == 3:
                    break
            rest = len(lines) - len(names)
            if rest > 0 and names:
                names.append(f"ещё {rest}")
            found[str(row.get("Ref_Key") or "")] = "; ".join(names)
    return found


def _order_subjects(client: _ODataClient, keys: list[str]) -> dict[str, str]:
    """Комментарий заказа клиента: в нём обычно предмет несерийки и тендер."""
    found: dict[str, str] = {}
    clean = [key for key in keys if _optional_guid(key)]
    for start in range(0, len(clean), 20):
        chunk = clean[start : start + 20]
        filt = " or ".join(f"Ref_Key eq guid'{key}'" for key in chunk)
        try:
            rows = _rows(client, _ORDER, filt=f"({filt})", top=len(chunk), select="Ref_Key,Комментарий")
        except OnecLinkError:
            continue
        for row in rows:
            text = _plain(row.get("Комментарий"), 180)
            if text:
                found[str(row.get("Ref_Key") or "")] = text
    return found


def _order_product(client: _ODataClient, row: dict) -> str:
    lines = [line for line in (row.get("Товары") or []) if isinstance(line, dict) and not line.get("Отменено")]
    keys = {_optional_guid(str(line.get("Номенклатура_Key") or "")) for line in lines}
    keys.discard("")
    try:
        names = _titles(client, _NOMEN, keys) if keys else {}
    except OnecLinkError:
        names = {}
    shown: list[str] = []
    for line in lines:
        title = names.get(_optional_guid(str(line.get("Номенклатура_Key") or ""))) or _plain(line.get("Содержание"), 120)
        if title and title not in shown:
            shown.append(title)
        if len(shown) == 3:
            break
    rest = len(lines) - len(shown)
    if rest > 0 and shown:
        shown.append(f"ещё {rest}")
    return "; ".join(shown)


def _tkp_rows(client: _ODataClient, rows: list[dict]) -> list[dict]:
    def keys_of(*fields: str) -> set[str]:
        return {str(row.get(field) or "") for row in rows for field in fields}

    lookups = {
        "partners": (_PARTNER, keys_of("Партнер_Key", "ПартнерКонечногоЗаказчика_Key"), False),
        "parties": (_CONTRACTOR, keys_of("Контрагент_Key", "КонтрагентКонечныйЗаказчик_Key"), False),
        "deals": (_DEAL, keys_of("Сделка_Key"), False),
        "contracts": (_CONTRACT, keys_of("ДоговорКонтрагента_Key"), False),
        "orgs": (_ORG, keys_of("Организация_Key"), False),
        "users": (_USER, keys_of("Менеджер_Key"), False),
        "currencies": (_CURRENCY, keys_of("Валюта_Key"), False),
        "agreements": (_AGREEMENT, keys_of("Соглашение_Key"), False),
        "sale_orders": (_ORDER, keys_of("ЗаказКлиента_Key"), True),
    }
    # Каждый запрос OData открывает свой HTTP-клиент, поэтому справочники читаются параллельно.
    with ThreadPoolExecutor(max_workers=len(lookups) + 2) as pool:
        futures = {
            name: pool.submit(_titles, client, entity, keys, number=number)
            for name, (entity, keys, number) in lookups.items()
        }
        futures["products"] = pool.submit(_tkp_products, client, [str(row.get("Ref_Key") or "") for row in rows])
        futures["subjects"] = pool.submit(_order_subjects, client, list(keys_of("ЗаказКлиента_Key")))
        titles = {name: future.result() for name, future in futures.items()}
    partners, parties, deals = titles["partners"], titles["parties"], titles["deals"]
    contracts, orgs, users = titles["contracts"], titles["orgs"], titles["users"]
    currencies, agreements, sale_orders = titles["currencies"], titles["agreements"], titles["sale_orders"]
    products, subjects = titles["products"], titles["subjects"]

    orders = []
    for row in rows:
        order_key = _optional_guid(str(row.get("ЗаказКлиента_Key") or ""))
        end_customer = parties.get(str(row.get("КонтрагентКонечныйЗаказчик_Key") or "")) or partners.get(
            str(row.get("ПартнерКонечногоЗаказчика_Key") or "")
        )
        delivery_days = str(row.get("СрокПоставки") or "").strip()
        if delivery_days in {"", "0", "0.0"}:
            delivery_days = ""
        else:
            delivery_days = delivery_days.split(".", 1)[0] + " дн."
        amount = row.get("СуммаДокументаТКП")
        if not _money(amount):
            amount = row.get("СуммаДокумента")
        orders.append(
            {
                "key": str(row.get("Ref_Key") or "").strip(),
                "number": str(row.get("Number") or "").strip(),
                "date": _stamp(str(row.get("Date") or ""), with_time=True),
                "client": partners.get(str(row.get("Партнер_Key") or ""), ""),
                "counterparty": parties.get(str(row.get("Контрагент_Key") or ""), ""),
                "end_customer": end_customer or "",
                "deal": deals.get(str(row.get("Сделка_Key") or ""), ""),
                "contract": contracts.get(str(row.get("ДоговорКонтрагента_Key") or ""), ""),
                "order_number": sale_orders.get(order_key, ""),
                "organization": orgs.get(str(row.get("Организация_Key") or ""), ""),
                "manager": users.get(str(row.get("Менеджер_Key") or ""), ""),
                "agreement": agreements.get(str(row.get("Соглашение_Key") or ""), ""),
                "currency": currencies.get(str(row.get("Валюта_Key") or ""), ""),
                "amount": _money_text(amount),
                "status": status_label(str(row.get("Статус") or "")),
                "valid_until": _stamp(str(row.get("СрокДействия") or "")),
                "delivery_days": delivery_days,
                "payment_form": _enum_label(str(row.get("ФормаОплаты") or "")),
                "delivery": _enum_label(str(row.get("СпособДоставки") or "")),
                "vat": _enum_label(str(row.get("НалогообложениеНДС") or "")),
                "approved": _yes(row.get("Согласован")),
                "agreed": _yes(row.get("СогласованоСКлиентом")),
                "operation": _enum_label(str(row.get("ХозяйственнаяОперация") or "")),
                "has_order": "1" if order_key else "",
                "kind": "tkp",
                "comment": _plain(row.get("Комментарий")),
                "product": products.get(str(row.get("Ref_Key") or ""), ""),
                "order_subject": subjects.get(order_key, ""),
            }
        )
    return orders


TKP_PAGE_CACHE_SECONDS = 120
_TKP_PAGE_CACHE_SIZE = 40
_tkp_pages: dict[tuple, tuple[float, dict]] = {}
_tkp_seen: dict[str, dict[str, str]] = {"status": {}, "manager": {}}
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_POSTED = "DeletionMark eq false and Posted eq true"
# Каждое совпадение — условие в адресе запроса; больше 1С не принимает (HTTP 414).
_TKP_QUERY_KEYS = 6


def _matching_keys(client: _ODataClient, entity: str, query: str) -> list[str]:
    try:
        rows = _rows(
            client,
            entity,
            filt=f"DeletionMark eq false and substringof('{_quote(query)}', Description)",
            top=_TKP_QUERY_KEYS,
            select="Ref_Key",
        )
    except OnecLinkError:
        return []
    return [key for key in (str(row.get("Ref_Key") or "") for row in rows) if _optional_guid(key)]


def _tkp_filter(client: _ODataClient, filters: dict[str, str]) -> str | None:
    """Фильтры импорта в $filter OData: страница считается в 1С, а не в памяти сервера.

    None — под фильтр заведомо ничего не попадёт (менеджер не найден).
    """
    parts: list[str] = []
    date_from = (filters.get("date_from") or "").strip()
    date_to = (filters.get("date_to") or "").strip()
    if _DAY.match(date_from):
        parts.append(f"Date ge datetime'{date_from}T00:00:00'")
    if _DAY.match(date_to):
        parts.append(f"Date le datetime'{date_to}T23:59:59'")
    status = (filters.get("status") or "").strip()
    if status:
        raw = _tkp_seen["status"].get(status) or status
        parts.append(f"Статус eq '{_quote(raw)}'")
    manager = (filters.get("manager") or "").strip()
    if manager:
        key = _tkp_seen["manager"].get(manager, "")
        keys = [key] if key else _matching_keys(client, _USER, manager)
        if not keys:
            return None
        parts.append("(" + " or ".join(f"Менеджер_Key eq guid'{item}'" for item in keys) + ")")
    linked = (filters.get("has_order") or "").strip()
    if linked == "yes":
        parts.append(f"ЗаказКлиента_Key ne guid'{_EMPTY}'")
    elif linked == "no":
        parts.append(f"ЗаказКлиента_Key eq guid'{_EMPTY}'")
    query = _text_query(
        client,
        filters.get("q") or "",
        ["Number", "Комментарий"],
        [
            (_CONTRACTOR, "Контрагент_Key"),
            (_CONTRACTOR, "КонтрагентКонечныйЗаказчик_Key"),
            (_PARTNER, "Партнер_Key"),
        ],
    )
    if query:
        parts.append(query)
    return " and ".join(parts)


def _tkp_page_rows(client: _ODataClient, extra: str, skip: int, top: int) -> list[dict]:
    """Одна страница документов ТКП: top + 1 строка, чтобы знать, есть ли следующая."""
    attempts = [(_POSTED, _TKP_SELECT), ("DeletionMark eq false", _TKP_SELECT), ("DeletionMark eq false", "")]
    last: OnecLinkError | None = None
    for base, select in attempts:
        filt = f"{base} and {extra}" if extra else base
        try:
            return _rows(client, _TKP, filt=filt, top=top + 1, orderby="Date desc", skip=skip, select=select)
        except OnecLinkError as exc:
            last = exc
    raise last or OnecLinkError("1С не вернула коммерческие предложения", 502)


def _remember_tkp(rows: list[dict], orders: list[dict]) -> None:
    for row, item in zip(rows, orders, strict=False):
        raw = str(row.get("Статус") or "").strip()
        if raw and item.get("status"):
            _tkp_seen["status"][item["status"]] = raw
        manager = str(row.get("Менеджер_Key") or "").strip()
        if _optional_guid(manager) and item.get("manager"):
            _tkp_seen["manager"][item["manager"]] = manager


def recent_tkp_page(
    *,
    skip: int = 0,
    top: int = 50,
    filters: dict[str, str] | None = None,
    refresh: bool = False,
) -> dict:
    """Страница проведённых ТКП из 1С с фильтрами. Справочники читаются только для строк страницы."""
    skip = max(0, int(skip or 0))
    top = max(1, min(500, int(top or 50)))
    clean = {key: str(value or "").strip() for key, value in (filters or {}).items() if str(value or "").strip()}
    cache_key = (skip, top, tuple(sorted(clean.items())))
    now = time.monotonic()
    hit = _tkp_pages.get(cache_key)
    if hit and not refresh and now - hit[0] < TKP_PAGE_CACHE_SECONDS:
        return hit[1]
    client = _client()
    extra = _tkp_filter(client, clean)
    rows = [] if extra is None else _tkp_page_rows(client, extra, skip, top)
    rows = [row for row in rows if str(row.get("Ref_Key") or "").strip()]
    has_more = len(rows) > top
    rows = rows[:top]
    orders = _tkp_rows(client, rows)
    _remember_tkp(rows, orders)
    page = {
        "configured": True,
        "counterparties": [],
        "orders": orders,
        "skip": skip,
        "top": top,
        "has_more": has_more,
        "statuses": sorted(_tkp_seen["status"]),
        "managers": sorted(_tkp_seen["manager"]),
    }
    if len(_tkp_pages) >= _TKP_PAGE_CACHE_SIZE:
        _tkp_pages.pop(min(_tkp_pages, key=lambda item: _tkp_pages[item][0]))
    _tkp_pages[cache_key] = (now, page)
    return page


_sale_pages: dict[tuple, tuple[float, dict]] = {}
_sale_seen: dict[str, dict[str, str]] = {"status": {}, "manager": {}}
_ORDER_SELECT = "Ref_Key,Number,Date,Контрагент_Key,СуммаДокумента,Комментарий,Статус,Менеджер_Key,Валюта_Key"


def _sale_page_rows(client: _ODataClient, extra: str, skip: int, top: int) -> list[dict]:
    attempts = [(_POSTED, _ORDER_SELECT), ("DeletionMark eq false", _ORDER_SELECT), ("DeletionMark eq false", "")]
    last: OnecLinkError | None = None
    for base, select in attempts:
        filt = f"{base} and {extra}" if extra else base
        try:
            return _rows(client, _ORDER, filt=filt, top=top + 1, orderby="Date desc", skip=skip, select=select)
        except OnecLinkError as exc:
            last = exc
    raise last or OnecLinkError("1С не вернула заказы клиента", 502)


def _sale_filter(client: _ODataClient, filters: dict[str, str]) -> str | None:
    parts: list[str] = []
    date_from = (filters.get("date_from") or "").strip()
    date_to = (filters.get("date_to") or "").strip()
    if _DAY.match(date_from):
        parts.append(f"Date ge datetime'{date_from}T00:00:00'")
    if _DAY.match(date_to):
        parts.append(f"Date le datetime'{date_to}T23:59:59'")
    status = (filters.get("status") or "").strip()
    if status:
        raw = _sale_seen["status"].get(status) or status
        parts.append(f"Статус eq '{_quote(raw)}'")
    manager = (filters.get("manager") or "").strip()
    if manager:
        key = _sale_seen["manager"].get(manager, "")
        keys = [key] if key else _matching_keys(client, _USER, manager)
        if not keys:
            return None
        parts.append("(" + " or ".join(f"Менеджер_Key eq guid'{item}'" for item in keys) + ")")
    query = _text_query(
        client,
        filters.get("q") or "",
        ["Number", "Комментарий"],
        [(_CONTRACTOR, "Контрагент_Key")],
    )
    if query:
        parts.append(query)
    return " and ".join(parts)


def _sale_products(client: _ODataClient, keys: list[str]) -> dict[str, str]:
    """Номенклатура строк заказа клиента — состав несерийки."""
    lines_of: dict[str, list[dict]] = {}
    nomen: set[str] = set()
    clean = [key for key in keys if _optional_guid(key)]
    for start in range(0, len(clean), 15):
        chunk = clean[start : start + 15]
        filt = " or ".join(f"Ref_Key eq guid'{key}'" for key in chunk)
        try:
            rows = _rows(client, _ORDER, filt=f"({filt})", top=len(chunk), select="Ref_Key,Товары")
        except OnecLinkError:
            continue
        for row in rows:
            lines = [line for line in (row.get("Товары") or []) if isinstance(line, dict) and not line.get("Отменено")]
            lines_of[str(row.get("Ref_Key") or "")] = lines
            nomen.update(_optional_guid(str(line.get("Номенклатура_Key") or "")) for line in lines)
    nomen.discard("")
    try:
        names = _titles(client, _NOMEN, nomen) if nomen else {}
    except OnecLinkError:
        names = {}
    found: dict[str, str] = {}
    for key, lines in lines_of.items():
        shown: list[str] = []
        for line in lines:
            title = names.get(_optional_guid(str(line.get("Номенклатура_Key") or ""))) or _plain(line.get("Содержание"), 120)
            if title and title not in shown:
                shown.append(title)
            if len(shown) == 3:
                break
        rest = len(lines) - len(shown)
        if rest > 0 and shown:
            shown.append(f"ещё {rest}")
        found[key] = "; ".join(shown)
    return found


def recent_sale_orders_page(
    *,
    skip: int = 0,
    top: int = 50,
    filters: dict[str, str] | None = None,
    refresh: bool = False,
) -> dict:
    """Страница проведённых заказов клиента: комментарий и состав, не только номер."""
    skip = max(0, int(skip or 0))
    top = max(1, min(500, int(top or 50)))
    clean = {key: str(value or "").strip() for key, value in (filters or {}).items() if str(value or "").strip()}
    clean.pop("has_order", None)
    cache_key = (skip, top, tuple(sorted(clean.items())))
    now = time.monotonic()
    hit = _sale_pages.get(cache_key)
    if hit and not refresh and now - hit[0] < TKP_PAGE_CACHE_SECONDS:
        return hit[1]
    client = _client()
    extra = _sale_filter(client, clean)
    rows = [] if extra is None else _sale_page_rows(client, extra, skip, top)
    rows = [row for row in rows if str(row.get("Ref_Key") or "").strip()]
    has_more = len(rows) > top
    rows = rows[:top]
    party_keys = {str(row.get("Контрагент_Key") or "") for row in rows}
    user_keys = {str(row.get("Менеджер_Key") or "") for row in rows}
    currency_keys = {str(row.get("Валюта_Key") or "") for row in rows}
    with ThreadPoolExecutor(max_workers=4) as pool:
        parties_f = pool.submit(_titles, client, _CONTRACTOR, party_keys)
        users_f = pool.submit(_titles, client, _USER, user_keys)
        currencies_f = pool.submit(_titles, client, _CURRENCY, currency_keys)
        products_f = pool.submit(_sale_products, client, [str(row.get("Ref_Key") or "") for row in rows])
        parties, users, currencies, products = parties_f.result(), users_f.result(), currencies_f.result(), products_f.result()
    orders = []
    for row in rows:
        ref = str(row.get("Ref_Key") or "").strip()
        status = status_label(str(row.get("Статус") or ""))
        manager = users.get(str(row.get("Менеджер_Key") or ""), "")
        raw_status = str(row.get("Статус") or "").strip()
        if raw_status and status:
            _sale_seen["status"][status] = raw_status
        raw_manager = str(row.get("Менеджер_Key") or "").strip()
        if _optional_guid(raw_manager) and manager:
            _sale_seen["manager"][manager] = raw_manager
        orders.append(
            {
                "key": ref,
                "kind": "order",
                "number": str(row.get("Number") or "").strip(),
                "date": _stamp(str(row.get("Date") or ""), with_time=True),
                "counterparty": parties.get(str(row.get("Контрагент_Key") or ""), ""),
                "amount": _money_text(row.get("СуммаДокумента")),
                "currency": currencies.get(str(row.get("Валюта_Key") or ""), ""),
                "manager": manager,
                "status": status,
                "comment": _plain(row.get("Комментарий")),
                "product": products.get(ref, ""),
                "order_subject": _plain(row.get("Комментарий")),
            }
        )
    page = {
        "configured": True,
        "counterparties": [],
        "orders": orders,
        "skip": skip,
        "top": top,
        "has_more": has_more,
        "statuses": sorted(_sale_seen["status"]),
        "managers": sorted(_sale_seen["manager"]),
    }
    if len(_sale_pages) >= _TKP_PAGE_CACHE_SIZE:
        _sale_pages.pop(min(_sale_pages, key=lambda item: _sale_pages[item][0]))
    _sale_pages[cache_key] = (now, page)
    return page


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
