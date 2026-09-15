"""Задачи документа как в ТД_ЗадачиДокумента (листовые строки, колонка Исполнитель)."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Callable

from app.services.erp_tasks import from_1c_datetime, task_is_late

_ODATA_ENTITY = "Task_ЗадачаИсполнителя"
_USER_CATALOG = "Catalog_Пользователи"

_FIO_WS = re.compile(r"\s+")


def normalize_fio(value: str) -> str:
    return _FIO_WS.sub(" ", (value or "").strip()).casefold()


def fio_matches(actual: str, expected: str) -> bool:
    left = normalize_fio(actual)
    right = normalize_fio(expected)
    if not left or not right:
        return False
    if left == right:
        return True
    return left.startswith(right) or right.startswith(left)


def executor_from_row(row: dict[str, Any]) -> str:
    for key in (
        "Исполнитель_Name",
        "ИсполнительDescription",
        "executor",
        "performer",
        "Executor",
        "Performer",
    ):
        text = str(row.get(key) or "").strip()
        if text:
            return text
    nested = row.get("Исполнитель")
    if isinstance(nested, dict):
        for key in ("Description", "description", "Name"):
            text = str(nested.get(key) or "").strip()
            if text:
                return text
    return str(row.get("Исполнитель") or "").strip()


def row_is_open(row: dict[str, Any]) -> bool:
    for key in ("Executed", "executed", "done", "Done", "Выполнена"):
        if key in row:
            return not bool(row.get(key))
    completed = str(row.get("ДатаИсполнения") or row.get("completed_at") or "").strip()
    if completed and not completed.startswith("0001-01-01"):
        return False
    result = str(row.get("Результат") or row.get("result") or "").strip()
    if result and result not in {"—", "-"}:
        return False
    return True


def filter_document_executor_rows(
    rows: list[dict[str, Any]],
    *,
    fio: str,
    only_open: bool,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not fio_matches(executor_from_row(row), fio):
            continue
        if only_open and not row_is_open(row):
            continue
        out.append(row)
    return out


def _parse_odata_dt(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text or text.startswith("0001-01-01"):
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", ""))
    except ValueError:
        return None
    return from_1c_datetime(parsed) or parsed


def map_document_executor_row(row: dict[str, Any], *, fio: str) -> dict[str, Any]:
    """Map OData / TasksII row to orchestrator docflow task (source 1С ДО)."""
    done = not row_is_open(row) if "Executed" in row or "executed" in row else False
    if "Executed" in row:
        done = bool(row.get("Executed"))
    elif "executed" in row:
        done = bool(row.get("executed"))

    created = _parse_odata_dt(row.get("Date") or row.get("date"))
    due = _parse_odata_dt(
        row.get("СрокИсполнения")
        or row.get("due")
        or row.get("deadline")
        or row.get("Срок")
    )
    completed = _parse_odata_dt(row.get("ДатаИсполнения") or row.get("completed_at"))

    action = " ".join(
        str(
            row.get("Description")
            or row.get("action")
            or row.get("name")
            or row.get("step")
            or ""
        ).split()
    )
    subject = " ".join(
        str(
            row.get("ПредметСтрокой")
            or row.get("document")
            or row.get("subject")
            or row.get("target")
            or row.get("description")
            or ""
        ).split()
    )
    if subject and action and normalize_fio(action) != normalize_fio(subject):
        title = f"{subject} — {action}"
    else:
        title = action or subject

    comment = " ".join(
        str(row.get("Описание") or row.get("Комментарий") or row.get("comment") or "").split()
    )
    approval = str(row.get("СостояниеБизнесПроцесса") or row.get("step") or "").strip()

    return {
        "number": str(row.get("Number") or row.get("number") or row.get("id") or "").strip(),
        "title": title,
        "status": "выполнена" if done else "открыта",
        "done": done,
        "late": task_is_late(done=done, completed_at=completed, due_at=due),
        "created_at": created.isoformat(sep=" ") if created else "",
        "due_at": due.isoformat(sep=" ") if due else "",
        "completed_at": completed.isoformat(sep=" ") if completed else "",
        "comment": comment,
        "approval": approval or ("завершена" if done else "не согласовано"),
        "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "performer": executor_from_row(row) or fio,
        "source": "документооборот",
    }


def odata_entity() -> str:
    return _ODATA_ENTITY


def odata_executor_filter_clauses(user_key: str) -> list[list[str]]:
    """Filter variants for «Исполнитель» on Task_ЗадачаИсполнителя (/doc OData)."""
    key = user_key.strip()
    if not key:
        return []
    return [
        [f"Исполнитель_Key eq guid'{key}'"],
        [f"Исполнитель eq cast(guid'{key}','{_USER_CATALOG}')"],
    ]


def fetch_executor_tasks_odata(
    *,
    user_key: str,
    fio: str,
    only_open: bool,
    limit: int,
    date_from: datetime | None,
    date_to: datetime | None,
    get_page: Callable[..., dict[str, Any]],
    auth_args: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Load rows matching ТД_ЗадачиДокумента executor column via OData."""
    from app.services.docflow_tasks import _odata_dt

    def _base_clauses() -> list[str]:
        clauses: list[str] = []
        if only_open:
            clauses.append("Executed eq false")
        if date_from is not None:
            clauses.append(f"Date ge datetime'{_odata_dt(date_from)}'")
        if date_to is not None:
            clauses.append(f"Date le datetime'{_odata_dt(date_to)}'")
        return clauses

    collected: list[dict[str, Any]] = []
    seen_numbers: set[str] = set()

    for variant in odata_executor_filter_clauses(user_key):
        filt = " and ".join([*variant, *_base_clauses()])
        try:
            data = get_page(
                _ODATA_ENTITY,
                params={"$top": limit, "$orderby": "Date desc", "$filter": filt},
                auth_args=auth_args,
            )
        except Exception:
            continue
        for row in data.get("value") or []:
            if not isinstance(row, dict):
                continue
            if not fio_matches(executor_from_row(row), fio):
                continue
            if only_open and not row_is_open(row):
                continue
            number = str(row.get("Number") or "").strip()
            marker = number or str(row.get("Ref_Key") or "")
            if marker and marker in seen_numbers:
                continue
            if marker:
                seen_numbers.add(marker)
            collected.append(map_document_executor_row(row, fio=fio))
        if collected:
            break
    return collected[:limit]
