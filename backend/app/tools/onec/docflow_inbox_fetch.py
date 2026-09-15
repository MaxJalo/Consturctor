"""Fetch docflow inbox via colleague SOAP module when OData is unavailable."""

from __future__ import annotations

from typing import Any

from app.tools.onec.docflow_inbox_map import map_inbox_payload

_MISSING = (
    "SOAP документооборота: нет app.tools.onec.dok_soap "
    "(скопируйте dok_soap.py и dok_http.py из репозитория коллеги в "
    "orchestrator/backend/app/tools/onec/)."
)


def soap_modules_available() -> bool:
    try:
        import app.tools.onec.dok_soap  # noqa: F401
    except ImportError:
        return False
    return True


def fetch_inbox_tasks_soap(
    fio: str,
    *,
    since_days: int = 90,
) -> tuple[list[dict[str, Any]], str]:
    try:
        from app.tools.onec.dok_soap import fetch_user_inbox_tasks
    except ImportError:
        return [], _MISSING

    payload = fetch_user_inbox_tasks(fio.strip(), since_days=since_days)
    if not isinstance(payload, dict):
        return [], "SOAP документооборота: неожиданный ответ"
    user_fio = str(payload.get("user_fio") or fio).strip() or fio
    return map_inbox_payload(payload, fio=user_fio), ""
