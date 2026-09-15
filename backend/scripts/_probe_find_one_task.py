# -*- coding: utf-8 -*-
"""Thorough search for MY_NAME tasks: SQL all states, OData, docflow, author roles."""
from __future__ import annotations

import io
import json
import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ORCH = BACKEND.parent
WORKSPACE = ORCH.parent
sys.path.insert(0, str(BACKEND))

ENV_PATHS = (WORKSPACE / ".env", ORCH / ".env", BACKEND / ".env")
for env_path in ENV_PATHS:
    if not env_path.is_file():
        continue
    for line in env_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, _, value = raw.partition("=")
        if key.strip() and key.strip() not in os.environ:
            os.environ[key.strip()] = value.strip()

fio = (os.environ.get("MY_NAME") or "").strip()
USER_ID = "885434321E82D8094E17EAE8D9276D36"
REF_HEX = "980E6CB31113810E11F1599041290A43"


def ref_to_guid(hexref: str) -> str:
    h = hexref.replace("0x", "").strip()
    return str(uuid.UUID(bytes_le=bytes.fromhex(h)))


def fmt_due(raw) -> str:
    if raw is None:
        return "—"
    if hasattr(raw, "isoformat"):
        return raw.isoformat(sep=" ")[:19]
    return str(raw)[:19]


def main() -> int:
    import httpx
    from app.clients import erp_sql
    from app.config import settings
    from app.services.erp_tasks import (
        _query_tasks,
        earliest_task_date,
        from_1c_datetime,
        list_current_tasks,
        list_tasks_for_period,
        resolve_actor,
    )

    out = io.StringIO()

    def w(s: str = "") -> None:
        out.write(s + "\n")

    w("=== FIND ONE TASK probe ===")
    w(f"time: {datetime.now().isoformat(sep=' ', timespec='seconds')}")
    w(f"MY_NAME: {fio}")

    # Identity
    w("\n--- Identity ---")
    try:
        relaxed = erp_sql.find_user_by_fio_relaxed(fio)
        w(f"find_user_by_fio_relaxed: OK id={relaxed.id} fio={relaxed.fio!r}")
    except Exception as exc:
        relaxed = None
        w(f"find_user_by_fio_relaxed: {type(exc).__name__}: {exc}")
    try:
        by_id = erp_sql.find_user_by_id(USER_ID)
        w(f"find_user_by_id({USER_ID[:8]}…): {by_id.fio if by_id else 'NONE'}")
    except Exception as exc:
        w(f"find_user_by_id error: {exc}")

    af, uid = resolve_actor(fio=fio, user_id=USER_ID)
    w(f"resolve_actor: fio={af!r} user_id={uid}")

    ref_bytes = bytes.fromhex(REF_HEX)
    guid = ref_to_guid(REF_HEX)
    w(f"performer GUID: {guid}")

    # 1) SQL ALL tasks by executor ref
    w("\n--- 1. SQL _Task39/_Task39X1 by _Fld2503_RRRef (ALL, TOP 50 recent) ---")
    all_sql: list[dict] = []
    conn = erp_sql._connect()
    try:
        cur = conn.cursor()
        cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")
        for table in ("dbo._Task39X1", "dbo._Task39"):
            cur.execute(
                f"""
                SELECT TOP 50
                    CAST(t._Number AS nvarchar(32)),
                    CAST(t._Name AS nvarchar(500)),
                    t._Date_Time,
                    t._Fld2515,
                    t._Executed,
                    CAST(u._Description AS nvarchar(256))
                FROM {table} t WITH (NOLOCK)
                INNER JOIN dbo._Reference366 u WITH (NOLOCK)
                    ON t._Fld2503_RRRef = u._IDRRef
                WHERE t._Marked = 0x00 AND t._Fld2503_RRRef = ?
                ORDER BY t._Date_Time DESC
                """,
                (ref_bytes,),
            )
            rows = cur.fetchall()
            w(f"{table}: {len(rows)} row(s)")
            for row in rows[:50]:
                done = row[4] in (b"\x01", 1)
                st = "выполнена" if done else "открыта"
                num = str(row[0] or "").strip()
                title = str(row[1] or "")[:80]
                due = fmt_due(from_1c_datetime(row[3]) if row[3] else None)
                w(f"  [{num}] {title} | срок: {due} | {st}")
                if num and num not in {x["number"] for x in all_sql}:
                    all_sql.append(
                        {
                            "number": num,
                            "title": row[1],
                            "due": due,
                            "status": st,
                            "done": done,
                            "table": table,
                        }
                    )

        # Author field _Fld2502 if exists — probe column
        w("\n--- 1b. SQL tasks where user is AUTHOR (_Fld2502_RRRef) ---")
        for table in ("dbo._Task39X1", "dbo._Task39"):
            try:
                cur.execute(
                    f"""
                    SELECT TOP 20
                        CAST(t._Number AS nvarchar(32)),
                        CAST(t._Name AS nvarchar(500)),
                        t._Executed
                    FROM {table} t WITH (NOLOCK)
                    WHERE t._Marked = 0x00 AND t._Fld2502_RRRef = ?
                    ORDER BY t._Date_Time DESC
                    """,
                    (ref_bytes,),
                )
                auth_rows = cur.fetchall()
                w(f"{table} author ref: {len(auth_rows)}")
                for row in auth_rows[:10]:
                    st = "выполнена" if row[2] in (b"\x01", 1) else "открыта"
                    w(f"  [{row[0]}] {str(row[1] or '')[:60]} | {st}")
            except Exception as exc:
                w(f"{table} author query: {exc}")

        w("\n--- 1c. Global open tasks count (sanity) ---")
        for table in ("dbo._Task39X1", "dbo._Task39"):
            cur.execute(
                f"""
                SELECT COUNT(*) FROM {table} WITH (NOLOCK)
                WHERE _Marked=0x00 AND _Executed=0x00
                """
            )
            w(f"{table} open total in DB: {cur.fetchone()[0]}")
    finally:
        conn.close()

    # 2) list_tasks_for_period include_done
    w("\n--- 2. list_tasks_for_period (include_done=true) ---")
    ed = earliest_task_date()
    d_from = (ed or datetime(2010, 1, 1).date()).isoformat()
    d_to = datetime.now().date().isoformat()
    w(f"period: {d_from} … {d_to}")
    try:
        period = list_tasks_for_period(
            fio=fio,
            user_id=uid,
            date_from=d_from,
            date_to=d_to,
            include_done=True,
            limit=100,
        )
        tasks_p = period.get("tasks") or []
        w(f"count={len(tasks_p)} docflow_warning={period.get('docflow_warning')!r}")
        open_p = [t for t in tasks_p if not t.get("done")]
        w(f"open={len(open_p)} done={len(tasks_p) - len(open_p)}")
        for i, t in enumerate(tasks_p[:15], 1):
            w(
                f"  {i}. [{t.get('number')}] {str(t.get('title') or '')[:65]} "
                f"| {t.get('due_at') or '—'} | {t.get('status')}"
            )
    except Exception as exc:
        w(f"ERROR: {exc}")

    w("\n--- 2b. list_current_tasks (only_open, ТД_ЗадачиМне-like) ---")
    try:
        cur_tasks = list_current_tasks(fio=fio, user_id=uid, limit=50)
        ct = cur_tasks.get("tasks") or []
        w(f"count={len(ct)} open={sum(1 for t in ct if not t.get('done'))}")
    except Exception as exc:
        w(f"ERROR: {exc}")

    w("\n--- 2c. _query_tasks only_open=false vs true ---")
    for label, oo in (("only_open=True", True), ("only_open=False", False)):
        rows = _query_tasks(fio=af, only_open=oo, limit=50)
        w(f"{label}: total={len(rows)} open={sum(1 for r in rows if not r.get('done'))}")

    # 3) OData
    w("\n--- 3. OData Task_ЗадачаИсполнителя ---")
    base = (settings.odata_base_url or "").rstrip("/")
    auth = (settings.odata_username, settings.odata_password)
    ent = "Task_ЗадачаИсполнителя"
    cat = "Catalog_Пользователи"

    filters = [
        ("executor NO Executed filter", f"Исполнитель eq cast(guid'{guid}','{cat}')"),
        ("executor open", f"Executed eq false and Исполнитель eq cast(guid'{guid}','{cat}')"),
        ("executor_Key", f"Исполнитель_Key eq guid'{guid}'"),
        ("executor_Key open", f"Executed eq false and Исполнитель_Key eq guid'{guid}'"),
    ]
    odata_all: list[dict] = []
    odata_open: list[dict] = []
    sample_keys: list[str] = []
    for label, filt in filters:
        r = httpx.get(
            f"{base}/{ent}",
            auth=auth,
            timeout=120,
            params={"$top": 50, "$filter": filt, "$orderby": "Date desc"},
            headers={"Accept": "application/json"},
        )
        w(f"{label}: HTTP {r.status_code}")
        if r.status_code != 200:
            w(f"  {r.text[:250]}")
            continue
        items = r.json().get("value") or []
        w(f"  count={len(items)}")
        if items and not sample_keys:
            sample_keys = sorted(items[0].keys())
            crm = [k for k in sample_keys if "CRM" in k or "crm" in k.lower() or "Автор" in k]
            w(f"  CRM/author keys: {crm[:25]}")
        for row in items[:8]:
            ex = row.get("Executed")
            w(
                f"    [{row.get('Number')}] Executed={ex} "
                f"{str(row.get('Description') or '')[:55]}"
            )
        if "NO Executed" in label or label.startswith("executor_Key") and "open" not in label:
            odata_all = items
        if "open" in label and items:
            odata_open = items

    # scan recent open globally for surname
    w("\n--- 3b. OData scan open $top=500 for Жалыбин in any field ---")
    r_scan = httpx.get(
        f"{base}/{ent}",
        auth=auth,
        timeout=180,
        params={"$top": 500, "$filter": "Executed eq false", "$orderby": "Date desc"},
        headers={"Accept": "application/json"},
    )
    w(f"HTTP {r_scan.status_code}")
    scan_hits = []
    if r_scan.status_code == 200:
        for row in r_scan.json().get("value") or []:
            blob = json.dumps(row, ensure_ascii=False)
            if "Жалыбин" in blob or "ZHAL" in blob.upper():
                scan_hits.append(row)
        w(f"rows with Жалыбин: {len(scan_hits)}")
        for row in scan_hits[:10]:
            w(f"  [{row.get('Number')}] {str(row.get('Description') or '')[:55]}")

    # 4) Subordinates — tasks for manager view?
    w("\n--- 4. Subordinate org (RK) ---")
    try:
        mgr, depts, people = erp_sql.load_subordinate_org(af)
        w(f"manager={mgr.fio!r} subordinates={len(people)}")
    except Exception as exc:
        w(f"load_subordinate_org: {exc}")

    # 5) Docflow
    w("\n--- 5. Docflow ---")
    try:
        from app.services.docflow_tasks import list_docflow_tasks

        for oo in (True, False):
            df = list_docflow_tasks(fio=af, only_open=oo, limit=30, auth_args=None)
            tasks_df = df.get("tasks") or []
            w(f"list_docflow_tasks only_open={oo}: count={len(tasks_df)} warning={df.get('warning')!r}")
            for i, t in enumerate(tasks_df[:10], 1):
                w(
                    f"  {i}. [{t.get('number')}] {str(t.get('title') or '')[:55]} "
                    f"| {t.get('status')}"
                )
    except Exception as exc:
        w(f"docflow error: {type(exc).__name__}: {exc}")

    # Summary for parent
    w("\n=== SUMMARY FOR USER (Russian numbered) ===")
    candidates: dict[str, dict] = {}

    def add_c(task: dict, source: str) -> None:
        num = str(task.get("number") or task.get("Number") or "").strip()
        if not num:
            return
        if num not in candidates or not candidates[num].get("done") and task.get("done"):
            pass
        title = str(task.get("title") or task.get("Description") or task.get("title") or "—")
        due = task.get("due_at") or task.get("due") or task.get("Date") or "—"
        if task.get("done") is not None:
            st = "открыта" if not task.get("done") else "выполнена"
        else:
            st = task.get("status") or "?"
        candidates[num] = {
            "number": num,
            "title": title[:120],
            "due": str(due)[:19],
            "status": st,
            "source": source,
            "open": st == "открыта" or task.get("done") is False,
        }

    for t in all_sql:
        add_c({**t, "done": t.get("done")}, "sql_by_ref")
    try:
        for t in period.get("tasks") or []:
            add_c(t, "list_tasks_for_period")
    except NameError:
        pass
    for row in odata_all:
        add_c(
            {
                "number": row.get("Number"),
                "title": row.get("Description"),
                "due_at": row.get("СрокИсполнения") or row.get("Date"),
                "done": row.get("Executed"),
            },
            "odata_executor",
        )
    try:
        for t in ct:
            add_c(t, "list_current")
    except NameError:
        pass

    open_c = [c for c in candidates.values() if c.get("open")]
    w(f"Unique task numbers collected: {len(candidates)} (open: {len(open_c)})")

    show = open_c if open_c else list(candidates.values())[:50]
    show.sort(key=lambda x: x["number"], reverse=True)
    if not show:
        w("(список пуст — 0 задач во всех источниках)")
    else:
        for i, c in enumerate(show[:50], 1):
            w(
                f"{i}. № {c['number']} — {c['title']} | срок: {c['due']} | "
                f"{c['status']} [{c['source']}]"
            )

    text = out.getvalue()
    path = ORCH / "output" / "find_one_task_probe.txt"
    path.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
