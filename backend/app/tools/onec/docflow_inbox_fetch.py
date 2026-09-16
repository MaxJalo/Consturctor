"""Fetch docflow inbox via HTTP SOAP (dm.1cws), not OData."""

from __future__ import annotations

from typing import Any

from app.tools.onec.docflow_inbox_map import map_inbox_payload
from app.tools.onec.dok_soap import fetch_user_inbox_tasks, soap_configured


def soap_modules_available() -> bool:
    return True


def fetch_inbox_tasks_soap(
    fio: str,
    *,
    since_days: int = 90,
    only_open: bool = True,
    today_and_overdue: bool = False,
    force_refresh: bool = False,
    auth_args: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    # auth_args may still carry session FIO/password; SOAP Basic uses OData/.env, not FIO.
    _ = auth_args
    if not soap_configured():
        return [], "Документооборот SOAP: нет учётных данных. Войдите с паролем 1С."
    payload = fetch_user_inbox_tasks(
        fio.strip(),
        since_days=since_days,
        only_open=only_open,
        retrieve=False,
        today_and_overdue=today_and_overdue,
        force_refresh=force_refresh,
    )
    if not isinstance(payload, dict):
        return [], "Документооборот HTTP: неожиданный ответ"
    user_fio = str(payload.get("user_fio") or fio).strip() or fio
    return map_inbox_payload(payload, fio=user_fio), ""
