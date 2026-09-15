"""Задачи 1С:Документооборот (публикация /doc).

OData: ``Task_ЗадачаИсполнителя`` с фильтром по колонке **Исполнитель**
(листовые задачи как в обработке ``ТД_ЗадачиДокумента``).
HTTP fallback: ``{DOK_HTTP_BASE_URL}/TasksII/User`` (hs/dterp).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.config import settings
from app.services.docflow_document_tasks import (
    fetch_executor_tasks_odata,
    map_document_executor_row,
    odata_entity,
)
from app.services.erp_tasks import from_1c_datetime, task_is_late
from app.services.onec_response_text import (
    decode_http_body,
    format_onec_http_error,
    looks_like_garbled,
    sanitize_onec_error_snippet,
)

_TASK_ENTITY = odata_entity()
_USER_ENTITY = "Catalog_Пользователи"


class DocflowError(RuntimeError):
    pass


def docflow_base_url() -> str:
    explicit = settings.docflow_odata_base_url.strip()
    if explicit:
        return explicit.rstrip("/")
    erp = settings.odata_base_url.strip()
    if "/erp_pm/" in erp:
        return erp.replace("/erp_pm/", "/doc/").rstrip("/")
    return ""


def _credentials_from_args(args: dict[str, Any] | None) -> tuple[str, str] | None:
    payload = args if isinstance(args, dict) else {}
    # Документооборот: учётные записи как в 1С (ФИО), не slug name_mail из erp_pm.
    username = str(
        payload.get("fio")
        or payload.get("erp_login")
        or payload.get("user")
        or payload.get("username")
        or ""
    ).strip()
    password = str(payload.get("password") or payload.get("erp_password") or "").strip()
    if username and password:
        return username, password
    return None


def docflow_env_auth() -> tuple[str, str] | None:
    """Gateway .env fallback when desktop session did not forward a password."""
    user = (settings.docflow_odata_username or settings.erp_login).strip()
    password = (settings.docflow_odata_password or settings.erp_password).strip()
    if user and password:
        return user, password
    # odata.user часто есть только в erp_pm; для /doc — явные DOCFLOW_* или ERP_LOGIN.
    odata_user = settings.odata_username.strip()
    odata_pass = settings.odata_password.strip()
    if not user and not password and odata_user and odata_pass:
        return odata_user, odata_pass
    return None


def docflow_auth(args: dict[str, Any] | None = None) -> tuple[str, str] | None:
    explicit = _credentials_from_args(args)
    if explicit:
        return explicit
    return docflow_env_auth()


def docflow_configured() -> bool:
    return bool(docflow_base_url() and docflow_env_auth())


def docflow_url_ready() -> bool:
    return bool(docflow_base_url())


def _odata_str(value: str) -> str:
    return (value or "").replace("'", "''")


def _odata_dt(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%S")


def _get(
    path: str,
    params: dict[str, Any] | None = None,
    *,
    auth_args: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = docflow_base_url()
    auth = docflow_auth(auth_args)
    if not base or not auth:
        raise DocflowError("OData документооборота не настроен")
    url = f"{base}/{path.lstrip('/')}"
    with httpx.Client(timeout=settings.odata_timeout_sec, auth=auth) as client:
        response = client.get(url, params=params, headers={"Accept": "application/json"})
    if response.status_code in {401, 402}:
        msg = (
            "Документооборот (/doc) отклонил учётку OData. "
            "Добавьте того же пользователя в базу 1С:Документооборот "
            "или войдите в Orchestrator с паролем 1С (учётка сеанса), "
            "либо задайте DOCFLOW_ODATA_USERNAME / DOCFLOW_ODATA_PASSWORD."
        )
        detail = sanitize_onec_error_snippet(decode_http_body(response.content))
        if detail and not looks_like_garbled(detail) and "отклонил учётку" not in detail:
            msg = f"{msg} ({detail})"
        raise DocflowError(msg)
    if response.status_code >= 400:
        raise DocflowError(format_onec_http_error(response, prefix="Документооборот OData"))
    data = response.json()
    return data if isinstance(data, dict) else {}


def find_user_key(fio: str, *, auth_args: dict[str, Any] | None = None) -> str:
    name = _odata_str(fio.strip())
    if not name:
        return ""
    data = _get(
        _USER_ENTITY,
        params={"$top": 5, "$filter": f"Description eq '{name}'"},
        auth_args=auth_args,
    )
    for row in data.get("value") or []:
        if isinstance(row, dict) and row.get("Ref_Key"):
            return str(row["Ref_Key"])
    return ""


def _parse_odata_dt(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text or text.startswith("0001-01-01"):
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", ""))
    except ValueError:
        return None
    return from_1c_datetime(parsed) or parsed


def _map_task(row: dict[str, Any], *, fio: str) -> dict[str, Any]:
    return map_document_executor_row(row, fio=fio)


def _list_docflow_via_soap(fio: str, *, limit: int) -> tuple[list[dict[str, Any]], str]:
    from app.tools.onec.docflow_inbox_fetch import fetch_inbox_tasks_soap

    tasks, warning = fetch_inbox_tasks_soap(fio, since_days=90)
    if limit > 0:
        tasks = tasks[: max(1, min(int(limit), 200))]
    return tasks, warning


def list_docflow_tasks(
    *,
    fio: str,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    only_open: bool = False,
    limit: int = 200,
    auth_args: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if not docflow_base_url() or not docflow_auth(auth_args):
        tasks, _ = _list_docflow_via_soap(fio, limit=limit)
        return tasks
    try:
        user_key = find_user_key(fio, auth_args=auth_args)
    except DocflowError:
        if only_open:
            tasks, _ = _list_docflow_via_soap(fio, limit=limit)
            return tasks
        raise
    if not user_key:
        if only_open:
            tasks, _ = _list_docflow_via_soap(fio, limit=limit)
            return tasks
        return []
    limit = max(1, min(int(limit or 200), 200))

    def _fetch(filter_clauses: list[str]) -> list[dict[str, Any]]:
        filt = " and ".join(filter_clauses)
        data = _get(
            _TASK_ENTITY,
            params={"$top": limit, "$orderby": "Date desc", "$filter": filt},
            auth_args=auth_args,
        )
        out: list[dict[str, Any]] = []
        for row in data.get("value") or []:
            if isinstance(row, dict):
                out.append(_map_task(row, fio=fio))
        return out

    def _base_clauses() -> list[str]:
        clauses: list[str] = []
        if only_open:
            clauses.append("Executed eq false")
        if date_from is not None:
            clauses.append(f"Date ge datetime'{_odata_dt(date_from)}'")
        if date_to is not None:
            clauses.append(f"Date le datetime'{_odata_dt(date_to)}'")
        return clauses

    try:
        to_me = fetch_executor_tasks_odata(
            user_key=user_key,
            fio=fio,
            only_open=only_open,
            limit=limit,
            date_from=date_from,
            date_to=date_to,
            get_page=_get,
            auth_args=auth_args,
        )
        if not to_me:
            to_me = _fetch(
                [
                    f"Исполнитель eq cast(guid'{user_key}','Catalog_Пользователи')",
                    *_base_clauses(),
                ]
            )

        http_tasks: list[dict[str, Any]] = []
        try:
            from app.tools.onec.docflow_http_tasks import fetch_document_executor_tasks_http

            http_tasks, _ = fetch_document_executor_tasks_http(
                user_ref=user_key,
                fio=fio,
                only_open=only_open,
                limit=limit,
                auth_args=auth_args,
            )
        except ImportError:
            pass

        from_me: list[dict[str, Any]] = []
        try:
            raw_from = _fetch(
                [
                    f"Автор eq cast(guid'{user_key}','Catalog_Пользователи')",
                    *_base_clauses(),
                ]
            )
            for item in raw_from:
                tagged = dict(item)
                tagged["source"] = "документооборот (от меня)"
                from_me.append(tagged)
        except DocflowError:
            pass
        from app.services.erp_tasks import merge_task_lists

        return merge_task_lists(to_me, http_tasks, from_me, limit=limit)
    except DocflowError:
        if only_open:
            tasks, _ = _list_docflow_via_soap(fio, limit=limit)
            return tasks
        raise


def list_docflow_for_people(
    fios: list[str],
    *,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    only_open: bool = False,
    limit_per_person: int = 200,
    auth_args: dict[str, Any] | None = None,
) -> tuple[dict[str, list[dict[str, Any]]], str]:
    warning = ""
    result: dict[str, list[dict[str, Any]]] = {name: [] for name in fios}
    if not docflow_base_url() or not docflow_auth(auth_args):
        return result, "Документооборот: нет URL/учётки OData"
    try:
        for name in fios:
            if not name:
                continue
            result[name] = list_docflow_tasks(
                fio=name,
                date_from=date_from,
                date_to=date_to,
                only_open=only_open,
                limit=limit_per_person,
                auth_args=auth_args,
            )
    except DocflowError as exc:
        warning = str(exc)
        merged_any = False
        for name in fios:
            if not name:
                continue
            soap_tasks, soap_warn = _list_docflow_via_soap(name, limit=limit_per_person)
            if soap_warn and not warning:
                warning = soap_warn
            if soap_tasks:
                result[name] = soap_tasks
                merged_any = True
        if merged_any:
            return result, warning
        return {name: [] for name in fios}, warning
    return result, warning


def handle_docflow_tasks(
    args: dict[str, Any],
    *,
    actor_fio: str = "",
    actor_user_id: str = "",
) -> dict[str, Any]:
    from app.services.erp_tasks import actor_from_jwt, parse_date

    fio, user_id = actor_from_jwt(args, actor_fio=actor_fio, actor_user_id=actor_user_id)
    date_from_raw = str(args.get("date_from") or args.get("dateFrom") or "").strip()
    date_to_raw = str(args.get("date_to") or args.get("dateTo") or "").strip()
    start = parse_date(date_from_raw) if date_from_raw else None
    finish = parse_date(date_to_raw, end=True) if date_to_raw else None
    include_done = args.get("include_done")
    only_open = True if include_done is None else not bool(include_done)
    if "only_open" in args:
        only_open = bool(args.get("only_open"))
    warning = ""
    try:
        tasks = list_docflow_tasks(
            fio=fio,
            date_from=start,
            date_to=finish,
            only_open=only_open,
            limit=int(args.get("limit") or 200),
            auth_args=args,
        )
    except DocflowError as exc:
        tasks = []
        warning = str(exc)
    return {
        "summary": f"Задачи документооборота: {len(tasks)} ({fio})",
        "fio": fio,
        "user_id": user_id,
        "count": len(tasks),
        "tasks": tasks,
        "source": "документооборот",
        "docflow_warning": warning,
    }


def stub_docflow_tasks(
    args: dict[str, Any],
    *,
    actor_fio: str = "",
    actor_user_id: str = "",
    **_: Any,
) -> dict[str, Any]:
    from app.services.erp_tasks import actor_from_args, actor_from_jwt

    fio, user_id = actor_from_args({}, actor_fio=actor_fio, actor_user_id=actor_user_id)
    token = str(args.get("access_token") or args.get("jwt") or args.get("token") or "").strip()
    if token:
        fio, user_id = actor_from_jwt(args, actor_fio=actor_fio, actor_user_id=actor_user_id)
    fio = fio or "Пользователь"
    return {
        "summary": f"stub: задачи документооборота ({fio})",
        "fio": fio,
        "user_id": user_id,
        "count": 0,
        "tasks": [],
        "source": "stub",
        "docflow_warning": "",
    }
