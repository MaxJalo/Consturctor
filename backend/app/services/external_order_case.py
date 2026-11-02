"""Файлы дела, извлечение, план, базовая версия и уведомления внешнего заказа.

Вывод без места в источнике не сохраняется. Утверждённый файл не удаляется.
Публикация плана не создаёт вторую копию задач.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from sqlalchemy.orm import Session

from app.config import BACKEND_ROOT
from app.models.external_order import (
    ExternalOrder,
    ExternalOrderBaseline,
    ExternalOrderDocument,
    ExternalOrderGap,
    ExternalOrderLine,
    ExternalOrderNotice,
    ExternalOrderTask,
)

_ALLOWED = {".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pdf": "application/pdf"}
_KINDS = {"tz", "tkp", "contract", "specification", "protocol", "condition", "acceptance", "correspondence", "other"}
_UPLOAD_ROLES = {"ks", "development", "rp", "legal", "kb", "finance", "omto", "production", "committee"}
_BLOCK_GATES = {
    "before_calc",
    "before_committee",
    "before_sign",
    "before_project",
    "before_production",
    "before_ship",
    "before_close",
}
_FIELDS = (
    ("subject", "предмет", "B02", "ks"),
    ("price", "цена", "B05", "finance"),
    ("vat", "ндс", "B06", "finance"),
    ("term", "срок", "B09", "rp"),
    ("payment", "оплат", "B13", "finance"),
    ("acceptance", "приемк", "B17", "production"),
    ("warranty", "гаранти", "B22", "legal"),
    ("sanctions", "санкц", "B24", "legal"),
)
_PLAN = (
    ("Уточнение требований", "stage", "ks"),
    ("Расчёт", "stage", "finance"),
    ("Договор", "milestone", "ks"),
    ("КД", "stage", "kb"),
    ("Закупки", "stage", "omto"),
    ("Изготовление", "stage", "production"),
    ("Испытания", "milestone", "production"),
    ("Приёмка", "milestone", "ks"),
    ("Отгрузка", "milestone", "omto"),
    ("Оплата и закрытие", "milestone", "finance"),
)
_REPEAT = ("kb", "omto", "finance", "production", "legal")
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_X = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def check_seed(gate: str, route: str, order_type: str, text: str) -> dict:
    applies, reason = _applies(route, order_type, gate, text)
    days = 2 if route == "accelerated" else 5
    return {
        "status": "not_applicable" if not applies else "not_started",
        "evidence": reason if not applies else "",
        "blocking": gate in _BLOCK_GATES and applies,
        "due_at": None if not applies else datetime.now(timezone.utc) + timedelta(days=days),
    }


def retarget_checks(order: ExternalOrder) -> None:
    for item in order.checks:
        if item.status == "done":
            continue
        applies, reason = _applies(order.route, order.order_type, item.gate, item.text)
        if not applies:
            item.status = "not_applicable"
            item.evidence = reason
            item.blocking = False
        elif item.status == "not_applicable":
            item.status = "not_started"
            item.evidence = ""
            item.blocking = item.gate in _BLOCK_GATES
            if item.due_at is None:
                item.due_at = datetime.now(timezone.utc) + timedelta(days=5)


def _applies(route: str, order_type: str, gate: str, text: str) -> tuple[bool, str]:
    folded = (order_type or "").casefold().replace("ё", "е")
    if route == "simplified" and gate not in {"before_calc", "before_sign", "before_close"}:
        return False, "упрощённый маршрут"
    if route == "accelerated" and gate == "before_psi":
        return False, "ускоренный маршрут"
    if gate == "before_psi" and "без пси" in folded:
        return False, "тип заказа без ПСИ"
    lowered = text.casefold().replace("ё", "е")
    if ("смр" in lowered or "пнр" in lowered) and "смр" not in folded and "пнр" not in folded:
        return False, "в типе заказа нет СМР и ПНР"
    return True, ""


def open_gate(order: ExternalOrder, gates: set[str]) -> str | None:
    for item in order.checks:
        if item.gate not in gates or item.status in {"done", "not_applicable"}:
            continue
        return item.text
    return None


def add_gap(db: Session, order: ExternalOrder, *, field: str, owner_role: str, detail: str, hours: int = 48) -> None:
    if any(item.field == field[:128] for item in _open_gaps(db, order)):
        return
    db.add(
        ExternalOrderGap(
            id=_new_id(),
            order_id=order.id,
            field=field[:128],
            owner_role=owner_role or "ks",
            due_at=datetime.now(timezone.utc) + timedelta(hours=hours),
            status="open",
            detail=detail,
        )
    )


def resolve_gaps(db: Session, order: ExternalOrder, field: str, resolution: str) -> int:
    closed = 0
    for item in _open_gaps(db, order):
        if item.field != field:
            continue
        item.status = "closed"
        item.detail = f"{item.detail} · закрыто: {resolution}"
        closed += 1
    return closed


def _open_gaps(db: Session, order: ExternalOrder) -> list[ExternalOrderGap]:
    """Пробелы дела вместе с ещё не сохранёнными в этой сессии."""
    rows = {id(item): item for item in order.gaps}
    for item in db.new:
        if isinstance(item, ExternalOrderGap) and item.order_id == order.id:
            rows[id(item)] = item
    return [item for item in rows.values() if item.status == "open"]


def notify(db: Session, order: ExternalOrder, *, kind: str, role: str, title: str, body: str) -> None:
    owners = {}
    try:
        import json

        owners = json.loads(order.owners_json or "{}")
    except json.JSONDecodeError:
        owners = {}
    mail = str((owners or {}).get(f"{role}_email") or "").strip()
    db.add(
        ExternalOrderNotice(
            id=_new_id(),
            order_id=order.id,
            kind=kind,
            role=role,
            title=title[:256],
            body=body,
            mail_status=(
                f"в карточке; письмо на {mail} не отправлялось" if mail else "в карточке; у роли нет почтового адреса"
            ),
        )
    )


def store_file(
    db: Session,
    order: ExternalOrder,
    *,
    role: str,
    fio: str,
    kind: str,
    filename: str,
    content_b64: str,
) -> ExternalOrderDocument:
    from app.services.external_orders import ExternalOrderError, _audit

    if role not in _UPLOAD_ROLES:
        raise ExternalOrderError("Файл в дело кладёт участник маршрута", 403)
    if role == "committee" and kind != "protocol":
        raise ExternalOrderError("Комитет прикладывает только протокол", 403)
    suffix = Path(filename or "").suffix.casefold()
    if suffix not in _ALLOWED:
        raise ExternalOrderError("В дело принимаются DOCX, XLSX и PDF", 400)
    if kind not in _KINDS:
        raise ExternalOrderError("Неизвестный вид документа", 400)
    try:
        raw = base64.b64decode(content_b64 or "", validate=True)
    except Exception as exc:  # noqa: BLE001
        raise ExternalOrderError("Файл не прочитан", 400) from exc
    if not raw or len(raw) > 12_000_000:
        raise ExternalOrderError("Файл пустой или больше 12 МБ", 400)
    digest = hashlib.sha256(raw).hexdigest()
    if any(item.sha256 == digest for item in order.documents):
        raise ExternalOrderError("Такой файл уже есть в деле", 409)
    version = f"v{_next_number([item.version for item in order.documents if item.kind == kind], 'v')}"
    doc_id = _new_id()
    folder = BACKEND_ROOT / "storage" / "external_orders" / order.id
    folder.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w.\-]+", "_", Path(filename).name)[:180] or f"file{suffix}"
    path = folder / f"{doc_id}_{safe}"
    path.write_bytes(raw)
    title = Path(filename).stem or kind
    doc = ExternalOrderDocument(
        id=doc_id,
        order_id=order.id,
        kind=kind,
        title=title,
        version=version,
        file_name=safe,
        stored_path=str(path),
        mime=_ALLOWED[suffix],
        sha256=digest,
        owner_role=role,
    )
    db.add(doc)
    db.flush()
    _extract(db, order, doc, raw, suffix)
    if kind == "specification" and _has_committee(order):
        _material_change(db, order, doc, fio)
    _audit(db, order, fio=fio, role=role, action="file", detail=f"{kind} {version}", after=safe)
    return doc


def approve_file(db: Session, order: ExternalOrder, document_id: str, *, role: str, fio: str) -> None:
    from app.services.external_orders import ExternalOrderError, _audit

    doc = _doc(order, document_id)
    if role not in {doc.owner_role, "ks"}:
        raise ExternalOrderError("Утверждает владелец файла или коммерческая служба", 403)
    before = "утверждён" if doc.approved else "не утверждён"
    doc.approved = True
    _audit(db, order, fio=fio, role=role, action="approve_file", detail=doc.title, before=before, after="утверждён")


def delete_file(db: Session, order: ExternalOrder, document_id: str, *, role: str, fio: str) -> None:
    from app.services.external_orders import ExternalOrderError, _audit

    if role not in _UPLOAD_ROLES:
        raise ExternalOrderError("Удалять файл может участник маршрута", 403)
    doc = _doc(order, document_id)
    if doc.approved:
        raise ExternalOrderError("Утверждённую версию удалять нельзя", 409)
    path = Path(doc.stored_path) if doc.stored_path else None
    _audit(
        db,
        order,
        fio=fio,
        role=role,
        action="delete_file",
        detail=doc.title,
        before=doc.version,
        after="",
    )
    if path and path.is_file():
        path.unlink()
    for line in [item for item in order.lines if item.document_id == doc.id]:
        order.lines.remove(line)
    for finding in [item for item in order.findings if item.document_id == doc.id and item.status == "draft"]:
        order.findings.remove(finding)
    order.documents.remove(doc)


def create_baseline(db: Session, order: ExternalOrder, *, role: str, fio: str, fields: dict) -> ExternalOrderBaseline:
    from app.services.external_orders import ExternalOrderError, _audit

    if role not in {"ks", "finance", "rp", "committee"}:
        raise ExternalOrderError("Базовую версию собирают КС, финансы, РП или Комитет", 403)
    required = ("composition", "cost", "mcr", "margin", "bdds", "deadlines")
    if any(not str(fields.get(key) or "").strip() for key in required):
        raise ExternalOrderError("Нужны состав, стоимость, МЦР, маржа, БДДС и сроки", 400)
    reason = str(fields.get("reason") or "").strip()
    if any(item.immutable for item in order.baselines) and not reason:
        raise ExternalOrderError("Новая базовая версия создаётся с основанием", 400)
    row = ExternalOrderBaseline(
        id=_new_id(),
        order_id=order.id,
        code=f"БВ-{_next_number([item.code for item in order.baselines], 'БВ-')}",
        composition=str(fields.get("composition") or ""),
        cost=str(fields.get("cost") or ""),
        mcr=str(fields.get("mcr") or ""),
        margin=str(fields.get("margin") or ""),
        bdds=str(fields.get("bdds") or ""),
        deadlines=str(fields.get("deadlines") or ""),
        reason=reason,
        created_by=fio,
    )
    db.add(row)
    resolve_gaps(db, order, "новая базовая версия", row.code)
    _audit(db, order, fio=fio, role=role, action="baseline", detail=row.code, after=reason)
    return row


def lock_baseline(order: ExternalOrder, baseline_id: str, code: str) -> ExternalOrderBaseline:
    """Протокол фиксирует только уже собранную версию: состав, стоимость, МЦР, маржа, БДДС и сроки."""
    from app.services.external_orders import ExternalOrderError

    wanted = code.strip().casefold()
    found = next(
        (
            item
            for item in order.baselines
            if (baseline_id and item.id == baseline_id) or (not baseline_id and wanted and item.code.casefold() == wanted)
        ),
        None,
    )
    if found is None:
        if not baseline_id and not wanted:
            raise ExternalOrderError("Нужны протокол и базовая версия", 400)
        raise ExternalOrderError(
            f"Базовая версия {code or baseline_id} не найдена в деле. Сначала соберите её: состав, стоимость, МЦР, маржа, БДДС и сроки",
            400,
        )
    if not all((found.composition, found.cost, found.mcr, found.margin, found.bdds, found.deadlines)):
        raise ExternalOrderError(f"Базовая версия {found.code} не заполнена: протоколом её зафиксировать нельзя", 400)
    found.immutable = True
    return found


def build_plan(db: Session, order: ExternalOrder, *, role: str, fio: str) -> int:
    from app.services.external_orders import ExternalOrderError, _audit

    if role not in {"rp", "ks"}:
        raise ExternalOrderError("Проект плана собирает руководитель проекта или коммерческая служба", 403)
    if list(order.tasks):
        return len(list(order.tasks))
    previous = ""
    created = 0
    for title, kind, owner in _PLAN:
        if title == "Испытания" and not _applies(order.route, order.order_type, "before_psi", title)[0]:
            continue
        task = ExternalOrderTask(
            id=_new_id(),
            order_id=order.id,
            title=title,
            kind=kind,
            owner_role=owner,
            depends_on=previous,
            critical=False,
            source_ref="обязательство договора",
        )
        order.tasks.append(task)
        previous = task.id
        created += 1
    _mark_critical_path(order)
    created += _term_milestone(db, order)
    _audit(db, order, fio=fio, role=role, action="plan", detail=f"задач: {created}")
    return created


def approve_plan(db: Session, order: ExternalOrder, *, role: str, fio: str) -> None:
    from app.services.external_orders import ExternalOrderError, _audit

    if role != "rp":
        raise ExternalOrderError("Базовым план становится после утверждения руководителем проекта", 403)
    if not list(order.tasks):
        raise ExternalOrderError("Сначала соберите проект плана", 400)
    for task in order.tasks:
        task.approved = True
    _audit(db, order, fio=fio, role=role, action="plan_approved", detail="базовый план", after="утверждён")


def _mark_critical_path(order: ExternalOrder) -> str:
    """Одна цепочка зависимостей и есть критический путь: его состав пишется в каждую задачу."""
    ordered = list(order.tasks)
    if not ordered:
        return ""
    chain = " → ".join(item.title for item in ordered)
    note = f"критический путь: {chain}"
    for item in ordered:
        item.critical = True
        if "Обязательство не было" not in str(item.source_ref or ""):
            item.source_ref = note
    return note


def _term_milestone(db: Session, order: ExternalOrder, term: str = "", source: str = "") -> int:
    """Срок есть в деле и его нет среди вех — предлагается веха и влияние на путь."""
    for item in order.findings:
        if item.field == "term" and str(item.value or "").strip():
            term = str(item.value).strip()
            source = str(item.source_ref or "").strip()
            break
    if not term:
        sections = {}
        try:
            loaded = json.loads(order.sections_json or "{}")
            sections = loaded if isinstance(loaded, dict) else {}
        except json.JSONDecodeError:
            sections = {}
        for bucket in (sections.get("project"), sections.get("contract"), sections.get("commercial")):
            if isinstance(bucket, dict):
                term = str(bucket.get("plan_note") or bucket.get("term") or bucket.get("deadlines") or "").strip()
                if term:
                    source = "поле карточки"
                    break
    if not term or not list(order.tasks):
        return 0
    if any("срок договора" in item.title.casefold() or term.casefold() in item.title.casefold() for item in order.tasks):
        return 0
    previous = list(order.tasks)[-1].id if list(order.tasks) else ""
    order.tasks.append(
        ExternalOrderTask(
            id=_new_id(),
            order_id=order.id,
            title=f"Срок договора: {term[:120]}",
            kind="milestone",
            owner_role="rp",
            depends_on=previous,
            critical=True,
            approved=False,
            source_ref=(
                f"Обязательство не было в плане ({source or 'дело'}). "
                "Веха на критическом пути, срок плана сдвигается до утверждения РП."
            ),
        )
    )
    db.flush()
    _mark_critical_path(order)
    return 1


def queue_turbo_plan(db: Session, order: ExternalOrder, *, role: str, fio: str) -> None:
    """TurboProject недоступен или не принимает запись: снимок плана остаётся в деле, уходит уведомление."""
    from app.services.external_orders import _audit, _dump, _load
    from app.services.turboproject import TurboProjectError, search_projects, turboproject_configured

    error = "TurboProject не настроен"
    if turboproject_configured():
        try:
            search_projects({"query": order.code, "limit": 1})
            error = "Запись задач в TurboProject не подключена"
        except TurboProjectError as exc:
            error = str(exc)[:300]
        except Exception as exc:  # noqa: BLE001
            error = str(exc)[:300]
    sections = _load(order.sections_json)
    previous = sections.get("turbo_queue") if isinstance(sections.get("turbo_queue"), dict) else {}
    attempts = int(previous.get("attempts") or 0) + 1
    snapshot = [
        {"title": item.title, "kind": item.kind, "depends_on": item.depends_on, "critical": bool(item.critical)}
        for item in order.tasks
    ]
    sections["turbo_queue"] = {
        "status": "queued",
        "attempts": attempts,
        "error": error,
        "tasks": snapshot,
    }
    order.sections_json = _dump(sections)
    notify(
        db,
        order,
        kind="turbo",
        role="rp",
        title="План в очереди TurboProject",
        body=f"Попытка {attempts}. {error}. Задачи плана сохранены в деле и не потеряны.",
    )
    _audit(db, order, fio=fio, role=role, action="turbo_queued", detail=f"попытка {attempts}", after=error[:200])


def publish_plan(db: Session, order: ExternalOrder, *, role: str, fio: str) -> None:
    from app.services.external_orders import ExternalOrderError

    if role != "rp":
        raise ExternalOrderError("В TurboProject публикует руководитель проекта", 403)
    tasks = list(order.tasks)
    if not tasks or not all(task.approved for task in tasks):
        raise ExternalOrderError("Публикуется только утверждённый план", 400)
    queue_turbo_plan(db, order, role=role, fio=fio)


def _extract(db: Session, order: ExternalOrder, doc: ExternalOrderDocument, raw: bytes, suffix: str) -> None:
    from app.services.external_orders import _audit

    if suffix == ".docx":
        _extract_lines(db, order, doc, _docx_paragraphs(raw))
    elif suffix == ".pdf":
        paragraphs = _pdf_lines(raw)
        if paragraphs is None:
            add_gap(
                db,
                order,
                field="pdf_text",
                owner_role="ks",
                detail=f"Источник: {doc.title} {doc.version}. Текст PDF не извлечён",
            )
            return
        _extract_lines(db, order, doc, paragraphs)
    elif suffix == ".xlsx" and doc.kind == "specification":
        rows = _xlsx_rows(raw)
        if not rows:
            add_gap(db, order, field="specification", owner_role="kb", detail="Строки спецификации не прочитаны")
            return
        changes = _compare(_previous_lines(order, doc), rows)
        _spec_diffs(order, doc, changes)
        for name, qty, amount, change in changes:
            db.add(
                ExternalOrderLine(
                    id=_new_id(),
                    order_id=order.id,
                    document_id=doc.id,
                    name=name[:512],
                    qty=qty,
                    amount=amount,
                    change=change,
                )
            )
        _audit(db, order, fio="система", role="agent", action="spec_lines", detail=f"строк: {len(changes)}")


def _extract_lines(db: Session, order: ExternalOrder, doc: ExternalOrderDocument, paragraphs: list[str]) -> None:
    found: set[str] = set()
    for index, line in enumerate(paragraphs, start=1):
        folded = line.casefold().replace("ё", "е")
        for field, token, code, owner in _FIELDS:
            if field in found or token not in folded:
                continue
            found.add(field)
            _remember(db, order, doc, field=field, value=line, location=f"абзац {index}", code=code, owner=owner)
    for field, _token, _code, owner in _FIELDS:
        if field not in found and doc.kind in {"contract", "tz", "tkp", "correspondence"}:
            add_gap(
                db,
                order,
                field=field,
                owner_role=owner,
                detail=f"Источник: {doc.title} {doc.version}. В тексте нет «{field}»",
            )


def _pdf_lines(raw: bytes) -> list[str] | None:
    try:
        import fitz
    except ImportError:
        return None
    try:
        document = fitz.open(stream=raw, filetype="pdf")
    except Exception:  # noqa: BLE001
        return None
    lines: list[str] = []
    for page in document:
        for line in (page.get_text() or "").splitlines():
            text = " ".join(line.split())
            if text:
                lines.append(text)
    return lines


def _spec_diffs(order: ExternalOrder, doc: ExternalOrderDocument, changes: list[tuple[str, str, str, str]]) -> None:
    interesting = [row for row in changes if row[3] != "same"]
    if not interesting:
        return
    source = f"{doc.title} {doc.version}"
    positions = "; ".join(f"{name} ({change})" for name, _qty, _amount, change in interesting)
    quantities = "; ".join(f"{name}: {qty or 'удалена'}" for name, qty, _amount, change in interesting if change != "amount")
    money = "; ".join(f"{name}: {amount or '0'}" for name, _qty, amount, _change in interesting if amount or _change == "removed")
    _set_diff(order, "B03", positions, f"{source}, позиции")
    if quantities:
        _set_diff(order, "B04", quantities, f"{source}, количество")
    if money:
        _set_diff(order, "B05", money, f"{source}, стоимость")


def _set_diff(order: ExternalOrder, code: str, value: str, note: str) -> None:
    match = next((item for item in order.diffs if item.code == code), None)
    if match is None or match.status == "closed":
        return
    if not str(match.left_value or "").strip():
        match.left_value = "прежняя спецификация"
    match.right_value = value[:2000]
    match.note = note[:2000]


def _remember(db: Session, order, doc, *, field: str, value: str, location: str, code: str, owner: str) -> None:
    from app.models.external_order import ExternalOrderFinding

    db.add(
        ExternalOrderFinding(
            id=_new_id(),
            order_id=order.id,
            field=field,
            value=value[:2000],
            source_ref=f"{doc.title} {doc.version}".strip(),
            location=location,
            document_id=doc.id,
            confidence="извлечено",
            status="draft",
            owner_role=owner,
            proposed_by="разбор файла",
        )
    )
    resolve_gaps(db, order, field, f"{doc.title} {doc.version}, {location}")
    match = next((item for item in order.diffs if item.code == code), None)
    if match is None or match.status == "closed":
        return
    if doc.kind == "tkp":
        match.left_value = value[:2000]
    elif doc.kind in {"contract", "specification"} or not str(match.right_value or "").strip():
        match.right_value = value[:2000]
    left = str(match.left_value or "").strip()
    right = str(match.right_value or "").strip()
    place = f"{doc.title} {doc.version}, {location}"
    match.note = f"{place}. Расхождение: «{left[:160]}» и «{right[:160]}»" if left and right and left.casefold() != right.casefold() else place
    if field == "term":
        _term_milestone(db, order, term=value, source=f"{doc.title} {doc.version}".strip())


def _previous_lines(order: ExternalOrder, doc: ExternalOrderDocument) -> list[ExternalOrderLine]:
    """Строки последней прежней спецификации: новая версия сравнивается только с ней."""
    with_lines = {line.document_id for line in order.lines}
    earlier = [
        item
        for item in order.documents
        if item.kind == "specification" and item.id != doc.id and item.id in with_lines
    ]
    if not earlier:
        return []
    latest = max(earlier, key=lambda item: _version_number(item.version, "v"))
    return [line for line in order.lines if line.document_id == latest.id and line.change != "removed"]


def _version_number(value: str, prefix: str) -> int:
    tail = (value or "").strip()
    if tail.casefold().startswith(prefix.casefold()):
        tail = tail[len(prefix):]
    return int(tail) if tail.isdigit() else 0


def _next_number(values: list[str], prefix: str) -> int:
    return max((_version_number(value, prefix) for value in values), default=0) + 1


def _compare(previous: list[ExternalOrderLine], rows: list[tuple[str, str, str]]) -> list[tuple[str, str, str, str]]:
    old = {item.name.casefold(): item for item in previous}
    seen: set[str] = set()
    out: list[tuple[str, str, str, str]] = []
    for name, qty, amount in rows:
        key = name.casefold()
        seen.add(key)
        prior = old.get(key)
        if prior is None:
            change = "added"
        elif prior.qty != qty:
            change = "qty"
        elif prior.amount != amount:
            change = "amount"
        else:
            change = "same"
        out.append((name, qty, amount, change))
    for key, prior in old.items():
        if key not in seen:
            out.append((prior.name, prior.qty, prior.amount, "removed"))
    return out


def _material_change(db: Session, order: ExternalOrder, doc: ExternalOrderDocument, fio: str) -> None:
    from app.services.external_orders import _audit

    notify(
        db,
        order,
        kind="change",
        role="rp",
        title="Новая спецификация после решения Комитета",
        body=f"{doc.title} {doc.version}. Нужны повторные заключения.",
    )
    for owner in _REPEAT:
        add_gap(
            db,
            order,
            field=f"повтор {owner}",
            owner_role=owner,
            detail=f"Повторное заключение по {doc.version}",
            hours=4,
        )
    add_gap(
        db,
        order,
        field="новая базовая версия",
        owner_role="finance",
        detail=f"Новая спецификация {doc.version}: базовую версию собрать заново с основанием",
    )
    _audit(db, order, fio=fio or "система", role="ks", action="change", detail=doc.version, after="повторные заключения")


def _has_committee(order: ExternalOrder) -> bool:
    return any(item.decision in {"confirmed", "confirmed_conditions"} for item in order.decisions)


def _doc(order: ExternalOrder, document_id: str) -> ExternalOrderDocument:
    from app.services.external_orders import ExternalOrderError

    found = next((item for item in order.documents if item.id == document_id), None)
    if found is None:
        raise ExternalOrderError("Документ не найден", 404)
    return found


def _docx_paragraphs(raw: bytes) -> list[str]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as package:
            xml = package.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile):
        return []
    root = ET.fromstring(xml)
    lines: list[str] = []
    for paragraph in root.iter(f"{_W}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{_W}t")).strip()
        if text:
            lines.append(text)
    return lines


def _xlsx_rows(raw: bytes) -> list[tuple[str, str, str]]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as package:
            shared = _shared_strings(package)
            sheet = package.read("xl/worksheets/sheet1.xml")
    except (KeyError, zipfile.BadZipFile):
        return []
    root = ET.fromstring(sheet)
    rows: list[tuple[str, str, str]] = []
    for row in root.iter(f"{_X}row"):
        cells: list[str] = []
        for cell in row.findall(f"{_X}c"):
            value = cell.find(f"{_X}v")
            text = value.text if value is not None and value.text else ""
            if cell.attrib.get("t") == "s" and text.isdigit():
                index = int(text)
                text = shared[index] if index < len(shared) else ""
            cells.append(text.strip())
        if not any(cells):
            continue
        name = cells[0] if cells else ""
        if not name or name.casefold() in {"наименование", "имя"}:
            continue
        qty = cells[1] if len(cells) > 1 else ""
        amount = cells[2] if len(cells) > 2 else ""
        rows.append((name, qty, amount))
    return rows


def _is_survey_sheet(doc: ExternalOrderDocument) -> bool:
    blob = f"{doc.title} {doc.file_name}".casefold().replace("ё", "е")
    return "опрос" in blob


def _col_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    if not letters:
        return -1
    index = 0
    for ch in letters:
        index = index * 26 + ord(ch.upper()) - 64
    return index - 1


def _cell_text(cell: ET.Element, shared: list[str]) -> str:
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{_X}t")).strip()
    value = cell.find(f"{_X}v")
    text = value.text if value is not None and value.text else ""
    if kind == "s" and text.isdigit():
        index = int(text)
        text = shared[index] if index < len(shared) else ""
    return text.strip()


def _sheet_grid(raw: bytes) -> list[list[str]]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as package:
            shared = _shared_strings(package)
            names = sorted(
                name
                for name in package.namelist()
                if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
            )
            sheets = [package.read(name) for name in names] or [package.read("xl/worksheets/sheet1.xml")]
    except (KeyError, zipfile.BadZipFile):
        return []
    grid: list[list[str]] = []
    for sheet in sheets:
        root = ET.fromstring(sheet)
        for row in root.iter(f"{_X}row"):
            placed: dict[int, str] = {}
            seq = 0
            for cell in row.findall(f"{_X}c"):
                text = _cell_text(cell, shared)
                index = _col_index(str(cell.attrib.get("r") or ""))
                if index < 0:
                    index = seq
                placed[index] = text
                seq = index + 1
            if not any(placed.values()):
                continue
            width = max(placed) + 1
            grid.append([placed.get(i, "") for i in range(width)])
    return grid


def survey_sheet_lines(order: ExternalOrder) -> list[str]:
    """Строки опросного листа из файлов дела. Путь 1С сюда не входит."""
    lines: list[str] = []
    for doc in order.documents:
        if not _is_survey_sheet(doc):
            continue
        path = Path(doc.stored_path) if doc.stored_path else None
        if path is None or not path.is_file():
            continue
        try:
            raw = path.read_bytes()
        except OSError:
            continue
        suffix = path.suffix.casefold()
        if suffix == ".docx":
            lines.extend(line[:240] for line in _docx_paragraphs(raw) if line.strip())
        elif suffix == ".xlsx":
            for cells in _sheet_grid(raw):
                filled = [item for item in cells if item]
                left = filled[0] if filled else ""
                right = filled[1] if len(filled) > 1 else ""
                if not left or left.casefold() in {"поле", "параметр", "наименование", "показатель"}:
                    continue
                lines.append(f"{left}: {right}".strip().rstrip(":")[:240] if right else left[:240])
        if len(lines) >= 30:
            break
    return lines[:30]


def _shared_strings(package: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in package.namelist():
        return []
    root = ET.fromstring(package.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter(f"{_X}t")) for item in root.findall(f"{_X}si")]


def _new_id() -> str:
    from uuid import uuid4

    return uuid4().hex


def refresh_overdue(db: Session, order: ExternalOrder) -> None:
    now = datetime.now(timezone.utc)
    for item in order.checks:
        due = item.due_at
        if due is not None and due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        if due is None or due >= now:
            continue
        if item.status not in {"open", "not_started", "in_progress", "review"}:
            continue
        item.status = "overdue"
        notify(db, order, kind="overdue", role=item.owner_role, title="Просрочен пункт чек-листа", body=item.text)


def extract_document_excerpts(order: ExternalOrder) -> list[dict]:
    """Извлекает текстовые фрагменты и таблицы из прикреплённых файлов дела (.docx, .xlsx)."""
    excerpts: list[dict] = []
    for doc in order.documents:
        entry: dict = {
            "id": doc.id,
            "kind": doc.kind,
            "title": doc.title,
            "version": doc.version,
            "file_name": doc.file_name,
            "approved": bool(doc.approved),
            "owner_role": doc.owner_role,
            "paragraphs": [],
            "rows": [],
        }
        path = Path(doc.stored_path) if doc.stored_path else None
        if path and path.is_file():
            try:
                raw = path.read_bytes()
                suffix = path.suffix.casefold()
                if suffix == ".docx":
                    entry["paragraphs"] = _docx_paragraphs(raw)[:25]
                elif suffix == ".xlsx":
                    entry["rows"] = [
                        {"name": name, "qty": qty, "amount": amount}
                        for name, qty, amount in _xlsx_rows(raw)[:40]
                    ]
            except Exception:  # noqa: BLE001
                pass
        excerpts.append(entry)
    return excerpts


def auto_prepare_order(
    db: Session,
    order: ExternalOrder,
    *,
    role: str = "ks",
    fio: str = "",
    step_id: str = "",
) -> list[str]:
    from app.services.external_orders import auto_prepare_order as _auto_prepare

    return _auto_prepare(db, order, role=role, fio=fio, step_id=step_id)


def build_stage_passports(order: ExternalOrder) -> list[dict]:
    from app.services.external_orders import build_stage_passports as _build_passports

    return _build_passports(order)


def build_role_questions(order: ExternalOrder) -> dict[str, list[dict]]:
    from app.services.external_orders import build_role_questions as _build_questions

    return _build_questions(order)


