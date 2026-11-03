"""ИИ-заполнение карточки внешнего заказа через Cursor.

Один запрос с выжимкой дела. Модель возвращает строгий JSON: черновики пустых полей
всех разделов (с источником и цитатой), доказательства по открытым пунктам чек-листа,
вопросы с пояснением и подсказкой из дела и проверку уже данных ответов.
Черновик остаётся черновиком: принимает владелец раздела.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.models.external_order import ExternalOrder

logger = logging.getLogger(__name__)

AI_PROPOSER = "ИИ · Cursor · правила eo-ai-1"
AI_CONFIDENCE = {"high": "ai:high", "medium": "ai:medium", "low": "ai:low"}
AI_TIMEOUT_SECONDS = 180

_EXCERPT_CHARS = 2500
_EXCERPTS_TOTAL = 16000
_QUOTE_CHARS = 300

Runner = Callable[[str], str]


def is_ai_finding(proposed_by: str, confidence: str) -> bool:
    return str(proposed_by or "").startswith("ИИ") or str(confidence or "").startswith("ai:")


def ai_available() -> tuple[bool, str]:
    from app.config import settings
    from app.services.cursor_sdk_local import SDK_ROOT

    if not (settings.cursor_api_key or "").strip():
        return False, "CURSOR_API_KEY не задан на сервере"
    if not (SDK_ROOT / "src" / "runner.ts").is_file():
        return False, "Cursor SDK не установлен на сервере"
    return True, ""


def _default_runner(prompt: str) -> str:
    from app.services.cursor_sdk_local import run_cursor_sdk

    return run_cursor_sdk(prompt, timeout=AI_TIMEOUT_SECONDS)


def field_catalog(row: ExternalOrder) -> list[dict[str, str]]:
    """Все поля карточки по службам с текущими значениями."""
    from app.services.external_orders import ROLE_FIELDS_SPEC, ROLES, _load

    sections = _load(row.sections_json)
    catalog: list[dict[str, str]] = []
    for role_id, specs in ROLE_FIELDS_SPEC.items():
        for spec in specs:
            bucket = sections.get(spec["section"]) if isinstance(sections.get(spec["section"]), dict) else {}
            catalog.append(
                {
                    "field": f"section:{spec['section']}.{spec['key']}",
                    "section": spec["section"],
                    "key": spec["key"],
                    "label": f"{spec['section_title']} · {spec['label']}",
                    "owner_role": role_id,
                    "owner_label": ROLES.get(role_id, role_id),
                    "prompt": spec["prompt"],
                    "current": str(bucket.get(spec["key"]) or "").strip(),
                }
            )
    return catalog


def _excerpts(case: dict) -> list[dict]:
    out: list[dict] = []
    left = _EXCERPTS_TOTAL
    for item in case.get("document_excerpts") or []:
        if left <= 0:
            break
        text = "\n".join(str(p) for p in item.get("paragraphs") or [] if str(p).strip())
        rows = item.get("rows") or []
        if rows:
            text += "\n" + "\n".join(
                f"{r.get('name', '')}; {r.get('qty', '')}; {r.get('amount', '')}" for r in rows[:40]
            )
        text = text.strip()[: min(_EXCERPT_CHARS, left)]
        left -= len(text)
        out.append(
            {
                "document": item.get("anchor") or item.get("title") or item.get("file_name") or item.get("kind"),
                "kind": item.get("kind"),
                "version": item.get("version"),
                "links": item.get("links") or [],
                "backlinks": item.get("backlinks") or [],
                "text": text,
            }
        )
    return out


_TKP_SKIP = {"key", "has_order"}


def _tkp_terms(case: dict) -> dict[str, str]:
    """Условия ТКП. Сначала то, что путь уже записал в карточку, без повторного чтения 1С."""
    from app.services.external_order_onec import tkp_card

    onec = (case.get("sections") or {}).get("onec") or {}
    stored = {
        key: str(onec.get(key) or "").strip()
        for key in (
            "vat",
            "currency",
            "delivery_days",
            "payment_form",
            "delivery",
            "valid_until",
            "product",
            "end_customer",
            "order_subject",
            "amount",
            "comment",
        )
        if str(onec.get(key) or "").strip()
    }
    if stored.get("vat") or stored.get("currency") or stored.get("delivery_days") or stored.get("payment_form"):
        return stored
    key = str(onec.get("tkp_key") or "").strip()
    if not key:
        return stored
    try:
        card = tkp_card(key)
    except Exception as exc:  # noqa: BLE001 — без 1С ИИ работает по делу

        logger.info("external order AI: ТКП из 1С не прочитано: %s", exc)
        return stored
    return {k: str(v) for k, v in card.items() if k not in _TKP_SKIP and str(v or "").strip()}


def case_payload(
    case: dict,
    catalog: list[dict[str, str]],
    answers: dict[str, str],
    tkp: dict[str, str] | None = None,
) -> dict:
    """Выжимка дела для модели: только то, что нужно для полей, без служебных id ссылок."""
    onec = (case.get("sections") or {}).get("onec") or {}
    return {
        "order": {
            "code": case.get("code"),
            "customer": case.get("customer"),
            "inn": case.get("inn"),
            "product": case.get("product"),
            "status": case.get("status_label"),
            "route": case.get("route_label"),
            "payment": case.get("payment_note"),
            "path_1c": case.get("path_label"),
            "owners": case.get("owners") or {},
            "known": case.get("known") or [],
        },
        "onec": {
            key: value
            for key, value in onec.items()
            if isinstance(value, (str, int, float)) and str(value).strip() and not key.endswith("_key")
        },
        "tkp_1c": tkp or {},
        "filled_fields": [
            {"field": item["field"], "label": item["label"], "value": item["current"]}
            for item in catalog
            if item["current"]
        ],
        "empty_fields": [
            {"field": item["field"], "label": item["label"], "owner": item["owner_label"], "what": item["prompt"]}
            for item in catalog
            if not item["current"]
        ],
        "lines": [
            {"name": line.get("name"), "qty": line.get("qty"), "amount": line.get("amount")}
            for line in (case.get("lines") or [])[:40]
        ],
        "documents": _excerpts(case),
        "file_links": [
            f"{item.get('from')} — {item.get('relation_label')} → {item.get('to')}"
            for item in (case.get("document_links") or [])
        ],
        "open_checks": [
            {"check_id": item.get("id"), "text": item.get("text"), "owner": item.get("owner_label")}
            for item in ((case.get("stage_passport") or {}).get("open_checks") or [])
        ],
        "open_gaps": [
            {"gap_id": item.get("id"), "field": item.get("field"), "detail": item.get("detail")}
            for item in case.get("gaps") or []
        ],
        "decisions": [
            {"decision": item.get("decision"), "protocol": item.get("protocol"), "conditions": item.get("conditions")}
            for item in case.get("decisions") or []
        ],
        "employee_answers": answers,
    }


PROMPT = """Ты — помощник служб по внешнему несерийному заказу. Тебе дана выжимка дела в JSON.
Задача: подготовить черновики пустых полей карточки, доказательства по открытым пунктам чек-листа
и вопросы сотруднику. Решения принимают люди: ты пишешь только черновики.

Правила:
1. Значение поля бери только из дела: документы, строки спецификации, 1С (в том числе условия ТКП в "tkp_1c":
   валюта, НДС, форма оплаты, доставка, срок действия, срок поставки, менеджер, конечный заказчик),
   заполненные поля, решения Комитета, ответы сотрудника, связи файлов в "file_links".
   Связь показывает, какой файл является приложением, основанием, версией или заменой другого: сверяй условия по ней, а не по одному файлу.
   Ничего не придумывай: ни цен, ни сроков, ни процентов, ни нормативов.
2. У каждого значения обязателен источник ("source": документ и версия, «1С заказ …», «Спецификация», «Ответ сотрудника»)
   и дословная цитата из источника ("quote", до 300 символов).
3. Если ответ уже есть в onec, tkp_1c, known или опросном листе — запиши черновик и не задавай вопрос.
   Вопрос в "questions" только для поля, которого нет ни в одном из этих источников.
4. Вопрос конкретный, по одному полю. "why" — зачем это поле нужно на этапе (одно предложение).
   "suggestion" — лучшая догадка из дела, если она есть, иначе пустая строка; "suggestion_source" — откуда догадка.
5. Если в "employee_answers" есть ответы, проверь каждый: противоречит ли он делу, полный ли он.
   Результат — в "answer_checks"; при неполном или спорном ответе дай уточняющий вопрос "followup".
6. Пиши по-русски, коротко. Верни только JSON, без пояснений и без markdown.

Схема ответа:
{
  "fields": [{"field": "section:раздел.ключ", "value": "...", "source": "...", "quote": "...", "confidence": "high|medium|low"}],
  "checks": [{"check_id": "...", "evidence": "...", "source": "..."}],
  "questions": [{"field": "section:раздел.ключ или check:id или gap:id", "question": "...", "why": "...", "suggestion": "...", "suggestion_source": "..."}],
  "answer_checks": [{"field": "...", "ok": true, "note": "...", "followup": "..."}]
}

Выжимка дела:
"""


_JSON_BLOCK = re.compile(r"\{.*\}", re.S)


def parse_ai_json(text: str) -> dict[str, Any]:
    raw = str(text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    match = _JSON_BLOCK.search(raw)
    if not match:
        raise ValueError("ответ модели без JSON")
    data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("ответ модели не объект")
    return {
        key: [item for item in data.get(key) or [] if isinstance(item, dict)]
        for key in ("fields", "checks", "questions", "answer_checks")
    }


def _clean(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def apply_ai_result(
    db: Session,
    row: ExternalOrder,
    data: dict[str, list[dict]],
    catalog: list[dict[str, str]],
) -> dict[str, Any]:
    """Пишет черновики ИИ только в пустые поля и открытые пункты; возвращает подсказки опроса."""
    from app.services.external_orders import _upsert_draft_finding

    empty = {item["field"]: item for item in catalog if not item["current"]}
    open_checks = {chk.id: chk for chk in row.checks if chk.status not in {"done", "not_applicable"}}
    open_gaps = {gap.id for gap in row.gaps if gap.status == "open"}
    filled: list[str] = []
    for item in data.get("fields") or []:
        field = _clean(item.get("field"), 128)
        spec = empty.get(field)
        value = _clean(item.get("value"), 2000)
        source = _clean(item.get("source"), 400)
        if not spec or not value or not source:
            continue
        confidence = AI_CONFIDENCE.get(_clean(item.get("confidence"), 8).lower(), "ai:medium")
        finding = _upsert_draft_finding(
            db,
            row,
            field=field,
            value=value,
            source_ref=source,
            location=_clean(item.get("quote"), _QUOTE_CHARS) or "цитата не приведена",
            owner_role=spec["owner_role"],
            proposed_by=AI_PROPOSER,
            confidence=confidence,
        )
        if finding is not None:
            finding.proposed_by = AI_PROPOSER
            finding.confidence = confidence
            filled.append(spec["label"])
    evidences = 0
    for item in data.get("checks") or []:
        check_id = _clean(item.get("check_id"), 64)
        chk = open_checks.get(check_id)
        evidence = _clean(item.get("evidence"), 1000)
        source = _clean(item.get("source"), 400)
        if chk is None or not evidence or not source:
            continue
        finding = _upsert_draft_finding(
            db,
            row,
            field=f"check:{chk.id}",
            value=evidence,
            source_ref=source,
            location=f"пункт «{chk.text}»",
            owner_role=chk.owner_role,
            proposed_by=AI_PROPOSER,
            confidence="ai:medium",
        )
        if finding is not None:
            finding.proposed_by = AI_PROPOSER
            finding.confidence = "ai:medium"
            evidences += 1
    from app.services.external_orders import _covered_by_known, known_facts

    facts = known_facts(row)
    hints: dict[str, dict[str, str]] = {}
    for item in data.get("questions") or []:
        field = _clean(item.get("field"), 128)
        key = field.rsplit(".", 1)[-1] if field.startswith("section:") else ""
        if key and _covered_by_known(key, facts):
            continue
        known = (
            field in empty
            or (field.startswith("check:") and field[6:] in open_checks)
            or (field.startswith("gap:") and field[4:] in open_gaps)
        )
        question = _clean(item.get("question"), 400)
        if not known or not question or field in hints:
            continue
        hints[field] = {
            "question": question,
            "why": _clean(item.get("why"), 300),
            "suggestion": _clean(item.get("suggestion"), 600),
            "suggestion_source": _clean(item.get("suggestion_source"), 300),
        }
    checks: dict[str, dict[str, Any]] = {}
    for item in data.get("answer_checks") or []:
        field = _clean(item.get("field"), 128)
        if not field:
            continue
        checks[field] = {
            "ok": bool(item.get("ok")),
            "note": _clean(item.get("note"), 400),
            "followup": _clean(item.get("followup"), 400),
        }
    return {"filled": filled, "evidences": evidences, "hints": hints, "answer_checks": checks}


def ai_prepare(
    db: Session,
    row: ExternalOrder,
    *,
    role: str,
    answers: dict[str, str] | None = None,
    runner: Runner | None = None,
) -> dict[str, Any]:
    """Запрос к Cursor и запись черновиков. Ошибка модели не роняет авто-подготовку."""
    from app.services.external_orders import read_full_case

    if runner is None:
        ready, reason = ai_available()
        if not ready:
            return {"ok": False, "error": reason, "log": [f"ИИ не подключён: {reason}"], "hints": {}, "answer_checks": {}}
        runner = _default_runner
    case = read_full_case(db, row.id, role=role)
    catalog = field_catalog(row)
    order_id = row.id
    code = row.code
    clean_answers = {k: v for k, v in (answers or {}).items() if str(v or "").strip()}
    payload = case_payload(case, catalog, clean_answers, {})
    # Соединение не должно висеть, пока 1С и Cursor отвечают.
    db.commit()
    try:
        if runner is _default_runner:
            payload["tkp_1c"] = _tkp_terms(case)
        data = parse_ai_json(runner(PROMPT + json.dumps(payload, ensure_ascii=False)))
    except Exception as exc:  # noqa: BLE001
        logger.warning("external order AI failed for %s: %s", code, exc)
        return {
            "ok": False,
            "error": str(exc)[:300],
            "log": ["ИИ не ответил — показаны черновики авто-проверки без ИИ"],
            "hints": {},
            "answer_checks": {},
        }
    fresh = db.get(ExternalOrder, order_id)
    if fresh is None:
        return {"ok": False, "error": "Заказ не найден", "log": ["Заказ не найден"], "hints": {}, "answer_checks": {}}
    result = apply_ai_result(db, fresh, data, catalog)
    log = ["ИИ прочитал дело"]
    if result["filled"]:
        log.append(f"ИИ заполнил черновиками {len(result['filled'])} полей: " + ", ".join(result["filled"][:8]))
    else:
        log.append("ИИ не нашёл в деле значений для пустых полей")
    if result["evidences"]:
        log.append(f"ИИ подобрал доказательства для {result['evidences']} пунктов чек-листа")
    if result["hints"]:
        log.append(f"ИИ подготовил подсказки к {len(result['hints'])} вопросам")
    return {"ok": True, "error": "", "log": log, **result}
