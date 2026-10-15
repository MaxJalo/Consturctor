"""Задачи 1С:Документооборот по мероприятиям поручений АСТ00.

Поручение ERP отражено в ДО внутренним документом с тем же GUID. Мероприятие N
поручения — задачи «Исполнить задачу №N» исполнителя и следующая за ними
проверка (утверждение) автора. Их task_id нужен, чтобы закрыть задачу или
вернуть её на доработку (onec.docflow_task_action / onec.docflow_rework).
"""

from __future__ import annotations

import logging
import os
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from typing import Any

logger = logging.getLogger(__name__)

_TASK_NO_RE = re.compile(r"задач[уаи]?\s*№\s*(\d+)", re.IGNORECASE)
_GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_REPORT_CHARS = 600
_MAX_WORKERS = 6


def _fold(value: Any) -> str:
    return " ".join(str(value or "").casefold().replace("ё", "е").split())


def task_kind(row: dict[str, Any]) -> str:
    text = _fold(f"{row.get('step') or ''} {row.get('name') or ''}")
    if any(tip in text for tip in ("ознаком", "перенос срока", "согласова", "рассмотреть вопрос")):
        return "other"
    if any(tip in text for tip in ("провер", "контрол", "утверд", "подтверд", "принят")):
        return "check"
    if "исполн" in text or "отправ" in text:
        return "execute"
    return "other"


def _task_view(row: dict[str, Any]) -> dict[str, Any]:
    report = str(row.get("description") or "").strip()
    if len(report) > _REPORT_CHARS:
        report = report[:_REPORT_CHARS].rstrip() + "…"
    return {
        "task_id": str(row.get("id") or ""),
        "kind": task_kind(row),
        "step": str(row.get("step") or ""),
        "name": str(row.get("name") or "")[:160],
        "performer": str(row.get("performer") or ""),
        "author": str(row.get("author") or ""),
        "begin": str(row.get("begin") or "")[:10],
        "due": str(row.get("due") or "")[:10],
        "executed": bool(row.get("executed")),
        "report": report,
    }


def _line_for_row(row: dict[str, Any], lines: list[dict[str, Any]]) -> dict[str, Any] | None:
    match = _TASK_NO_RE.search(str(row.get("name") or ""))
    if match:
        number = int(match.group(1))
        return next((line for line in lines if int(line.get("line") or 0) == number), None)
    performer = _fold(row.get("performer"))
    if performer:
        same = [line for line in lines if _fold(line.get("executor")) == performer]
        if len(same) == 1:
            return same[0]
    described = _fold(row.get("description"))[:120]
    if len(described) < 30:
        return None
    for line in lines:
        text = _fold(re.sub(r"^\s*\d+[.)]\s*", "", str(line.get("text") or "")))[:120]
        if text and (described.startswith(text[:80]) or text.startswith(described[:80])):
            return line
    return None


def _shared_lines(view: dict[str, Any], lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Одна задача без «№N» на все мероприятия исполнителя: ДО выпускает её по документу целиком.

    Исполнение — всем строкам этого исполнителя. Проверка автора — строкам,
    где последнее исполнение уже отмечено и проверки после него ещё нет.
    """
    if view["kind"] == "execute":
        performer = _fold(view["performer"])
        return [line for line in lines if performer and _fold(line.get("executor")) == performer]
    if view["kind"] != "check":
        return []
    waiting: list[dict[str, Any]] = []
    for line in lines:
        tasks = line["docflow_tasks"]
        executes = [task for task in tasks if task["kind"] == "execute"]
        if not executes or not executes[-1]["executed"]:
            continue
        if tasks[-1]["kind"] == "check":
            continue
        waiting.append(line)
    return waiting


def task_state(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    """Где сейчас мероприятие по маршруту ДО и какая задача открыта для действия."""
    executes = [task for task in tasks if task["kind"] == "execute"]
    checks = [task for task in tasks if task["kind"] == "check"]
    last_exec = executes[-1] if executes else None
    open_check = next((task for task in reversed(checks) if not task["executed"]), None)
    open_exec = next((task for task in reversed(executes) if not task["executed"]), None)
    if not tasks:
        label = "задачи в Документообороте нет"
    elif checks and checks[-1]["executed"] and not open_check and not open_exec:
        label = "принято проверяющим"
    elif open_check:
        label = "исполнитель отчитался, ждёт проверки"
    elif open_exec:
        label = "у исполнителя, не выполнено"
    elif last_exec and last_exec["executed"]:
        label = "исполнитель отметил выполнение"
    else:
        label = "статус не определён"
    report = next(
        (task["report"] for task in reversed(executes) if task["executed"] and task["report"]),
        "",
    )
    return {
        "label": label,
        "returns": max(0, len(executes) - 1),
        "executor_report": report,
        "open_check_task_id": open_check["task_id"] if open_check else "",
        "open_check_step": open_check["step"] if open_check else "",
        "open_check_name": open_check["name"] if open_check else "",
        "open_check_performer": open_check["performer"] if open_check else "",
        "open_execute_task_id": open_exec["task_id"] if open_exec else "",
    }


def link_tasks(item: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    lines = item.get("lines") if isinstance(item.get("lines"), list) else []
    for line in lines:
        line["docflow_tasks"] = []
    whole: list[dict[str, Any]] = []
    unique = {str(row.get("id") or id(row)): row for row in rows}
    for row in sorted(unique.values(), key=lambda r: str(r.get("begin") or "")):
        view = _task_view(row)
        line = _line_for_row(row, lines)
        if line is None and len(lines) == 1 and view["kind"] != "other":
            line = lines[0]
        if line is not None:
            line["docflow_tasks"].append(view)
            continue
        shared = _shared_lines(view, lines)
        if not shared:
            whole.append(view)
        for target in shared:
            target["docflow_tasks"].append(view)
    for line in lines:
        line["docflow_state"] = task_state(line["docflow_tasks"])
    item["docflow_tasks_assignment"] = whole[:10]


def _target_rows(config: Any, ref: str) -> list[dict[str, Any]]:
    """withExecuted=true в этой базе отдаёт только исполненные задачи: открытые читаем отдельно."""
    from app.services.docflow_protocols import _DO_TARGET_TYPE, _DO_TIMEOUT_SEC, _do_request
    from app.tools.onec.dok_soap import open_tasks_for_target

    rows = _do_request(config, ref)
    try:
        rows += open_tasks_for_target(config, ref, _DO_TARGET_TYPE, timeout=_DO_TIMEOUT_SEC)
    except (RuntimeError, ValueError, OSError, ET.ParseError) as exc:
        logger.warning("open docflow tasks for %s failed: %s", ref, str(exc)[:200])
    return rows


def _rows_for(config: Any, refs: list[str]) -> dict[str, list[dict[str, Any]]]:
    with ThreadPoolExecutor(max_workers=min(_MAX_WORKERS, len(refs))) as pool:
        futures = {ref: pool.submit(_target_rows, config, ref) for ref in refs}
        return {ref: future.result() for ref, future in futures.items()}


def _service_login() -> tuple[str, str]:
    """Служебная учётка ДО (DOK_HTTP_*): серверный запуск идёт без пароля пользователя."""
    from app.config import settings

    user = (os.environ.get("DOK_HTTP_USER") or settings.dok_http_user or "").strip()
    password = (os.environ.get("DOK_HTTP_PASSWORD") or settings.dok_http_password or "").strip()
    return (user, password) if user and password else ("", "")


def _session_rows(args: dict[str, Any], refs: list[str]) -> tuple[dict[str, list[dict[str, Any]]], str]:
    from app.tools.onec.docflow_inbox_fetch import _is_soap_http_auth_error, _soap_login_attempts
    from app.tools.onec.dok_soap import load_config

    error = "нет пароля 1С сеанса"
    attempts = list(_soap_login_attempts(args)) if str(args.get("password") or "").strip() else []
    service = _service_login()
    if service[0] and service not in attempts:
        attempts.append(service)
    for username, password in attempts:
        try:
            return _rows_for(load_config(username=username, password=password), refs), ""
        except (RuntimeError, ValueError, OSError, ET.ParseError) as exc:
            error = str(exc)
            if _is_soap_http_auth_error(error):
                continue
            logger.warning("assignment docflow tasks failed: %s", error[:300])
            break
    return {}, error


def attach_docflow_tasks(items: list[dict[str, Any]], args: dict[str, Any]) -> str:
    """Добавляет задачи ДО к мероприятиям. Возвращает пометку, если видны только открытые задачи."""
    refs = [
        str(item.get("ref_key") or "")
        for item in items
        if _GUID_RE.match(str(item.get("ref_key") or ""))
    ]
    refs = list(dict.fromkeys(refs))
    if not refs:
        return ""
    session = {
        "fio": str(args.get("docflow_login") or "").strip(),
        "password": str(args.get("docflow_password") or ""),
    }
    by_ref, error = _session_rows(session, refs)
    note = ""
    if error:
        from app.services.docflow_protocols import _dump_open_rows

        by_ref = _dump_open_rows(refs)
        note = (
            f"Документооборот под пользователем недоступен ({error[:160]}): "
            "показаны только открытые задачи из последней выгрузки, выполненных задач здесь нет"
        )
    for item in items:
        link_tasks(item, by_ref.get(str(item.get("ref_key") or ""), []))
    return note
