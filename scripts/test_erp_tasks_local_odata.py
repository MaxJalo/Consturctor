#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Local stack: ERP SQL tasks (_query_tasks / relevance clause) + optional OData probe.

Reads MY_NAME from workspace .env; OData/SQL from orchestrator/backend/.env (backend overrides).

Usage (VPN to erp_pm / ii1 when SQL runs on your PC):
  cd orchestrator
  py -3.12 scripts\\test_erp_tasks_local_odata.py

Optional HTTP check (local or LAN gateway):
  py -3.12 scripts/test_erp_tasks_local_odata.py --http
  py -3.12 scripts/test_erp_tasks_local_odata.py --http --backend-url http://192.168.1.157:7812

No local SQL (IM002 / no VPN): OData + optional gateway HTTP:
  py -3.12 scripts/test_erp_tasks_local_odata.py --odata-only
  py -3.12 scripts/test_erp_tasks_local_odata.py --odata-only --http --backend-url http://192.168.1.157:7812

Expected for Жалыбин Максим Дмитриевич (MY_NAME): at least task 00-Л-000040259 via SQL
when relevance clause matches title/FIO, not only _Fld2503 executor.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ORCH = Path(__file__).resolve().parents[1]
BACKEND = ORCH / "backend"
WORKSPACE = ORCH.parent
sys.path.insert(0, str(BACKEND))

ENV_PATHS = (
    WORKSPACE / ".env",
    ORCH / ".env",
    BACKEND / ".env",
)


def load_dotenv() -> None:
    for env_path in ENV_PATHS:
        if not env_path.is_file():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, _, value = raw.partition("=")
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key.strip()] = value.strip()


def odata_auth() -> tuple[str, str]:
    from app.config import settings  # noqa: E402

    user = (settings.odata_username or settings.erp_login or "").strip()
    password = (settings.odata_password or settings.erp_password or "").strip()
    return user, password


def print_sql_connect_hint(exc: Exception) -> None:
    blob = f"{type(exc).__name__}: {exc}".lower()
    if "im002" in blob or "data source name not found" in blob:
        print(
            "hint IM002: ODBC driver missing and/or hostname ERP_SQL_SERVER=ii1 not resolved "
            "(VPN off or no corporate DNS on this PC)."
        )
        print(
            "  fix SQL locally: install «ODBC Driver 17 for SQL Server» or "
            "«ODBC Driver 18 for SQL Server» (see ERP_SQL_DRIVER in backend/.env), "
            "connect VPN, keep ERP_SQL_SERVER=ii1."
        )
        print(
            "  skip SQL on this PC: add --odata-only (set ODATA_USERNAME/ODATA_PASSWORD "
            "or ERP_LOGIN/ERP_PASSWORD in backend/.env first)."
        )
        print(
            "  test relevance on deployed gateway (no local ODBC): "
            "py -3.12 scripts/test_erp_tasks_local_odata.py --http "
            "--backend-url http://192.168.1.157:7812"
        )
        return
    print("hint: VPN + ERP_SQL_SERVER=ii1 (Trusted Connection); or --odata-only / --http via gateway")


def print_odata_cred_hint() -> None:
    print(
        "skip: OData credentials missing. In orchestrator/backend/.env uncomment "
        "ONE auth block (do not commit secrets):"
    )
    print("  • ODATA_USERNAME=… and ODATA_PASSWORD=…  (erp_pm OData service user), or")
    print("  • ERP_LOGIN=… and ERP_PASSWORD=…  (same 1C login as desktop)")
    print("  ODATA_BASE_URL is already set; only user/password lines ~72–73 or ~87–88 need values.")


def probe_odata_task_entity(*, fio: str, expect_number: str) -> int:
    import httpx  # noqa: E402

    from app.config import settings  # noqa: E402

    base = (settings.odata_base_url or "").rstrip("/")
    user, password = odata_auth()
    print("\n--- OData Task_ЗадачаИсполнителя (erp_pm) ---")
    if not base:
        print("skip: ODATA_BASE_URL not set in backend/.env")
        return 2
    if not user or not password:
        print_odata_cred_hint()
        return 2
    print(f"base: {base}")
    print(f"user: {user}")
    entity = "Task_ЗадачаИсполнителя"
    auth = (user, password)
    timeout = float(settings.odata_timeout_sec or 60)
    r = httpx.get(
        f"{base}/{entity}",
        auth=auth,
        timeout=timeout,
        params={"$top": 1},
        headers={"Accept": "application/json"},
    )
    print(f"ping HTTP {r.status_code}")
    if r.status_code != 200:
        print(r.text[:240])
        return 1
    surname = fio.split()[0] if fio.split() else fio
    r_open = httpx.get(
        f"{base}/{entity}",
        auth=auth,
        timeout=max(timeout, 90),
        params={"$top": 400, "$orderby": "Date desc", "$filter": "Executed eq false"},
        headers={"Accept": "application/json"},
    )
    print(f"open scan HTTP {r_open.status_code}")
    hits: list[dict] = []
    if r_open.status_code == 200:
        for row in r_open.json().get("value") or []:
            blob = str(row)
            if expect_number in blob or surname in blob or fio in blob:
                hits.append(row)
        print(f"rows mentioning FIO / {expect_number}: {len(hits)}")
        for i, row in enumerate(hits[:12], 1):
            num = row.get("Number") or "?"
            title = str(row.get("Description") or row.get("Наименование") or "")[:70]
            print(f"  {i}. [{num}] {title}")
    else:
        print(r_open.text[:240])
        return 1
    return 0


def probe_sql(*, fio: str, expect_number: str) -> int:
    from app.services.erp_tasks import (  # noqa: E402
        ErpTaskError,
        _query_tasks,
        build_task_user_relevance_clause,
        list_current_tasks,
    )

    print("--- SQL _query_tasks (relevance: executor OR responsible OR title/comment FIO) ---")
    try:
        rows = _query_tasks(fio=fio, only_open=True, limit=80)
    except Exception as exc:  # noqa: BLE001
        print(f"_query_tasks error: {type(exc).__name__}: {exc}")
        print_sql_connect_hint(exc)
        return 1

    print(f"_query_tasks open count: {len(rows)}")
    for i, t in enumerate(rows[:15], 1):
        num = t.get("number") or "?"
        title = str(t.get("title") or "")[:70]
        perf = t.get("performer") or ""
        extra = f" | исп: {perf}" if perf else ""
        print(f"  {i}. [{num}] {title}{extra}")

    found = any(str(t.get("number") or "") == expect_number for t in rows)
    print(f"expect {expect_number!r} in SQL open list: {found}")

    print("\n--- list_current_tasks (tool payload shape) ---")
    try:
        result = list_current_tasks(fio=fio, user_id="", limit=80)
    except ErpTaskError as exc:
        print(f"ErpTaskError: {exc}")
        return 1
    tasks = result.get("tasks") or []
    open_tasks = [t for t in tasks if not t.get("done")]
    print(f"source: {result.get('source')} | tasks: {len(tasks)} | open: {len(open_tasks)}")
    for i, t in enumerate(open_tasks[:10], 1):
        print(f"  {i}. [{t.get('number')}] {str(t.get('title') or '')[:70]}")

    clause, _params = build_task_user_relevance_clause(
        unique_names=[fio],
        catalog_refs=[],
    )
    print(f"\nrelevance clause (refs empty demo): {clause[:120]}...")

    return 0 if found or len(open_tasks) >= 1 else 2


def probe_http(*, fio: str, base: str) -> None:
    password = (os.environ.get("MY_PASSWORD") or "").strip()
    print(f"\n--- HTTP onec.erp_tasks_current @ {base} ---")
    if not password:
        print("skip: MY_PASSWORD missing (workspace .env)")
        return
    base = base.rstrip("/")
    try:
        health = urllib.request.urlopen(f"{base}/health", timeout=8).read().decode()
        print("health:", health[:200])
    except Exception as exc:  # noqa: BLE001
        print(f"health FAIL: {exc}")
        return

    login_body = json.dumps({"fio": fio, "password": password, "client": "probe"}).encode()
    login_req = urllib.request.Request(
        f"{base}/api/v1/auth/login",
        data=login_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(login_req, timeout=45) as resp:
            login = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        print("login HTTP", exc.code, exc.read().decode()[:320])
        return

    token = login.get("access_token") or login.get("token")
    if not token and isinstance(login.get("tokens"), dict):
        token = login["tokens"].get("access_token")
    if not token:
        print("login ok but no token")
        return

    name_mail = (os.environ.get("MY_NAME_MAIL") or "").strip()
    args: dict[str, object] = {"fio": fio, "limit": 80, "password": password}
    if name_mail:
        args["username"] = name_mail
    invoke_body = json.dumps({"tool": "onec.erp_tasks_current", "arguments": args}).encode()
    invoke_req = urllib.request.Request(
        f"{base}/api/v1/tools/invoke",
        data=invoke_body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(invoke_req, timeout=90) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        print("invoke HTTP", exc.code, exc.read().decode()[:400])
        return

    result = data.get("result") if isinstance(data, dict) else {}
    tasks = (result or {}).get("tasks") or []
    print("invoke ok:", data.get("ok"), "count:", len(tasks), "source:", (result or {}).get("source"))
    for t in tasks[:8]:
        if isinstance(t, dict):
            print(f"  [{t.get('number')}] {str(t.get('title') or '')[:70]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Local ERP tasks + OData probe")
    parser.add_argument(
        "--http",
        action="store_true",
        help="Call /api/v1/tools/invoke (local run_dev.bat or LAN gateway)",
    )
    parser.add_argument(
        "--expect-number",
        default="00-Л-000040259",
        help="Task number to highlight (default: Жалыбин test case)",
    )
    default_backend = os.environ.get("PROBE_LOCAL", "http://127.0.0.1:7812")
    parser.add_argument(
        "--backend-url",
        "--api-base",
        dest="backend_url",
        default=default_backend,
        help="Backend base URL for --http (default: PROBE_LOCAL or http://127.0.0.1:7812)",
    )
    parser.add_argument(
        "--odata-only",
        action="store_true",
        help="Skip ERP SQL (use when IM002/no VPN); still runs OData unless --skip-odata",
    )
    parser.add_argument("--skip-odata", action="store_true", help="SQL only (or OData-only with --odata-only)")
    args = parser.parse_args()

    load_dotenv()
    fio = (os.environ.get("MY_NAME") or "").strip()
    print(f"MY_NAME: {fio or '(missing — set in workspace .env)'}")
    if not fio:
        return 2

    sql_code = 0
    if args.odata_only:
        print("--- SQL skipped (--odata-only) ---")
    else:
        sql_code = probe_sql(fio=fio, expect_number=args.expect_number)
        if sql_code != 0 and not args.skip_odata:
            print("\n(SQL failed; continuing with OData probe — or re-run with --odata-only)")

    odata_code = 0
    if not args.skip_odata:
        odata_code = probe_odata_task_entity(fio=fio, expect_number=args.expect_number)

    if args.http:
        probe_http(fio=fio, base=args.backend_url)

    if args.odata_only:
        return odata_code
    return sql_code


if __name__ == "__main__":
    raise SystemExit(main())
