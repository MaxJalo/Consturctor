# -*- coding: utf-8 -*-
"""Deep probe: MY_NAME open tasks via SQL + OData erp_pm. Writes UTF-8 report."""
from __future__ import annotations

import io
import os
import sys
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ORCH = BACKEND.parent
WORKSPACE = ORCH.parent
sys.path.insert(0, str(BACKEND))

ENV_PATHS = (
    WORKSPACE / ".env",
    ORCH / ".env",
    BACKEND / ".env",
)
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
OUT = ORCH / "output" / "erp_my_tasks_report.txt"
OUT.parent.mkdir(parents=True, exist_ok=True)

buf = io.StringIO()


def w(line: str = "") -> None:
    buf.write(line + "\n")


def task_line(i: int, task: dict) -> str:
    title = str(task.get("title") or task.get("Description") or "—")[:72]
    num = task.get("number") or task.get("Number") or "?"
    due = task.get("due_at") or task.get("due_raw") or task.get("Date") or "—"
    st = task.get("status") or ("open" if not task.get("done") else "done")
    perf = task.get("performer") or ""
    extra = f" | исп: {perf}" if perf else ""
    return f"  {i}. [{num}] {title} | срок: {due} | {st}{extra}"


def main() -> int:
    w(f"=== ERP open tasks report ===")
    w(f"generated: {datetime.now().isoformat(sep=' ', timespec='seconds')}")
    w(f"MY_NAME: {fio or '(missing)'}")
    if not fio:
        w("ERROR: MY_NAME missing")
        OUT.write_text(buf.getvalue(), encoding="utf-8")
        return 2

    import httpx  # noqa: E402
    from app.clients import erp_sql  # noqa: E402
    from app.config import settings  # noqa: E402
    from app.services.erp_tasks import (  # noqa: E402
        ErpTaskError,
        _query_tasks,
        list_current_tasks,
    )

    w("")
    w("--- 1. v8users / identity ---")
    v8 = None
    try:
        v8 = erp_sql.find_user_by_fio(fio)
        w(f"v8users find_user_by_fio: OK id={v8.id}")
        w(f"  fio={v8.fio!r} name={v8.name!r} descr={v8.descr!r}")
    except erp_sql.UserNotFoundError:
        w("v8users find_user_by_fio: NOT FOUND")
    except erp_sql.AmbiguousUserError as exc:
        w(f"v8users find_user_by_fio: AMBIGUOUS {exc}")
    except Exception as exc:  # noqa: BLE001
        w(f"v8users error: {type(exc).__name__}: {exc}")

    surname = fio.split()[0] if fio.split() else fio
    conn = erp_sql._connect()
    try:
        cur = conn.cursor()
        cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")

        w("")
        w("--- 2. Catalog_Пользователи (_Reference366) SQL ---")
        for label, sql, params in (
            (
                "exact _Description",
                """
                SELECT TOP 5 CAST(_Description AS nvarchar(256)) AS d,
                       CONVERT(varchar(36), _IDRRef, 1) AS ref_hex
                FROM dbo._Reference366 WITH (NOLOCK)
                WHERE LTRIM(RTRIM(_Description)) = ?
                """,
                (fio,),
            ),
            (
                "LIKE surname",
                """
                SELECT TOP 10 CAST(_Description AS nvarchar(256)) AS d,
                       CONVERT(varchar(36), _IDRRef, 1) AS ref_hex
                FROM dbo._Reference366 WITH (NOLOCK)
                WHERE _Description LIKE ?
                """,
                (f"%{surname}%",),
            ),
        ):
            cur.execute(sql, params)
            rows = cur.fetchall()
            w(f"{label}: {len(rows)} row(s)")
            for row in rows:
                w(f"  {row[0]!r} ref={row[1]}")

        w("")
        w("--- 3. Tasks via list_current_tasks (production path) ---")
        try:
            prod = list_current_tasks(fio=fio, user_id="", limit=50)
            tasks_prod = prod.get("tasks") or []
            w(f"count={len(tasks_prod)} user_id={prod.get('user_id')}")
            w(f"source={prod.get('source')} docflow_warning={prod.get('docflow_warning')!r}")
            open_prod = [t for t in tasks_prod if not t.get("done")]
            w(f"open (done=false): {len(open_prod)}")
            for i, t in enumerate(open_prod[:30], 1):
                w(task_line(i, t))
        except ErpTaskError as exc:
            w(f"ErpTaskError: {exc}")

        w("")
        w("--- 4. SQL _query_tasks variants ---")
        variants: list[tuple[str, list]] = [
            ("exact FIO (_Description join)", {"fio": fio, "only_open": True, "limit": 50}),
        ]
        if v8:
            alt_fios = []
            for candidate in (v8.descr, v8.name, v8.fio):
                c = (candidate or "").strip()
                if c and c not in alt_fios and c != fio:
                    alt_fios.append(c)
            for alt in alt_fios:
                variants.append((f"alt FIO {alt!r}", {"fio": alt, "only_open": True, "limit": 50}))
            variants.append(
                (
                    f"resolve user_id {v8.id}",
                    {"fio": fio, "only_open": True, "limit": 50},
                )
            )

        seen_numbers: set[str] = set()
        all_open: list[dict] = []

        for label, kwargs in variants:
            if label.startswith("resolve user_id"):
                from app.services.erp_tasks import resolve_actor  # noqa: E402

                af, uid = resolve_actor(fio=fio, user_id=v8.id if v8 else "")
                kwargs = {"fio": af, "only_open": True, "limit": 50}
                w(f"{label} -> fio={af!r} uid={uid}")
            try:
                rows = _query_tasks(**kwargs)
            except Exception as exc:  # noqa: BLE001
                w(f"{label}: ERROR {exc}")
                continue
            open_rows = [r for r in rows if not r.get("done")]
            w(f"{label}: total={len(rows)} open={len(open_rows)}")
            for r in open_rows[:5]:
                w(f"    [{r.get('number')}] {str(r.get('title') or '')[:60]}")

        w("")
        w("--- 5. Tasks by performer Ref (_Fld2503_RRRef) ---")
        ref_rows: list[tuple] = []
        cur.execute(
            """
            SELECT TOP 1 _IDRRef FROM dbo._Reference366 WITH (NOLOCK)
            WHERE LTRIM(RTRIM(_Description)) = ?
            """,
            (fio,),
        )
        ref_row = cur.fetchone()
        if not ref_row and v8:
            cur.execute(
                """
                SELECT TOP 1 u._IDRRef
                FROM dbo.v8users v WITH (NOLOCK)
                LEFT JOIN dbo._Reference366 u WITH (NOLOCK)
                  ON LTRIM(RTRIM(u._Description)) =
                     LTRIM(RTRIM(COALESCE(NULLIF(v.Descr, N''), v.Name)))
                WHERE v.ID = ?
                """,
                (v8.id,),
            )
            ref_row = cur.fetchone()
        if ref_row and ref_row[0]:
            ref_bytes = ref_row[0]
            w(f"performer Ref_Key bytes: {ref_bytes!r}")
            for table in ("dbo._Task39X1", "dbo._Task39"):
                cur.execute(
                    f"""
                    SELECT TOP 30
                        CAST(t._Number AS nvarchar(32)),
                        CAST(t._Name AS nvarchar(500)),
                        t._Fld2515,
                        t._Executed,
                        CAST(u._Description AS nvarchar(256))
                    FROM {table} t WITH (NOLOCK)
                    INNER JOIN dbo._Reference366 u WITH (NOLOCK)
                        ON t._Fld2503_RRRef = u._IDRRef
                    WHERE t._Marked = 0x00 AND t._Executed = 0x00
                      AND t._Fld2503_RRRef = ?
                    ORDER BY t._Date_Time DESC
                    """,
                    (ref_bytes,),
                )
                hits = cur.fetchall()
                w(f"{table} open by ref: {len(hits)}")
                for i, hit in enumerate(hits[:20], 1):
                    w(f"  {i}. [{hit[0]}] {str(hit[1] or '')[:65]} | due={hit[2]} | {hit[4]}")
                    num = str(hit[0] or "").strip()
                    if num and num not in seen_numbers:
                        seen_numbers.add(num)
                        all_open.append(
                            {
                                "number": num,
                                "title": hit[1],
                                "due_raw": hit[2],
                                "performer": hit[4],
                                "source": "erp_pm_sql_by_ref",
                            }
                        )
        else:
            w("No _Reference366 ref for user — skip ref query")

        w("")
        w("--- 6. Partial FIO in performer name (open tasks) ---")
        cur.execute(
            """
            SELECT TOP 50
                CAST(t._Number AS nvarchar(32)),
                CAST(t._Name AS nvarchar(500)),
                CAST(u._Description AS nvarchar(256))
            FROM (
                SELECT * FROM dbo._Task39X1 WITH (NOLOCK) WHERE _Marked=0x00 AND _Executed=0x00
                UNION ALL
                SELECT * FROM dbo._Task39 WITH (NOLOCK) WHERE _Marked=0x00 AND _Executed=0x00
            ) t
            INNER JOIN dbo._Reference366 u WITH (NOLOCK) ON t._Fld2503_RRRef = u._IDRRef
            WHERE u._Description LIKE ?
            ORDER BY t._Date_Time DESC
            """,
            (f"%{surname}%",),
        )
        # above may fail if union column mismatch — fallback simpler
    except Exception as exc:  # noqa: BLE001
        w(f"SQL block error: {type(exc).__name__}: {exc}")
        try:
            cur.execute(
                """
                SELECT TOP 30
                    CAST(t._Number AS nvarchar(32)) AS num,
                    CAST(t._Name AS nvarchar(500)) AS title,
                    CAST(u._Description AS nvarchar(256)) AS perf
                FROM dbo._Task39X1 t WITH (NOLOCK)
                INNER JOIN dbo._Reference366 u WITH (NOLOCK) ON t._Fld2503_RRRef = u._IDRRef
                WHERE t._Marked = 0x00 AND t._Executed = 0x00 AND u._Description LIKE ?
                ORDER BY t._Date_Time DESC
                """,
                (f"%{surname}%",),
            )
            for table_label, sql in (
                ("_Task39X1", None),
            ):
                pass
            partial = cur.fetchall()
            w(f"LIKE performer (_Task39X1): {len(partial)}")
            for i, hit in enumerate(partial[:20], 1):
                w(f"  {i}. [{hit[0]}] {str(hit[1] or '')[:60]} | {hit[2]}")
        except Exception as exc2:  # noqa: BLE001
            w(f"partial FIO fallback error: {exc2}")
    finally:
        conn.close()

    w("")
    w("--- 7. OData erp_pm (service account) ---")
    base = (settings.odata_base_url or "").rstrip("/")
    auth = (settings.odata_username, settings.odata_password)
    w(f"ODATA_BASE_URL: {base}")
    w(f"ODATA_USERNAME: {settings.odata_username}")

    task_ent = "Task_ЗадачаИсполнителя"
    r_ping = httpx.get(
        f"{base}/{task_ent}",
        auth=auth,
        timeout=60,
        params={"$top": 1},
        headers={"Accept": "application/json"},
    )
    w(f"Task entity ping: HTTP {r_ping.status_code}")

    sample_keys: list[str] = []
    executor_fields: list[str] = []
    r_sample = httpx.get(
        f"{base}/{task_ent}",
        auth=auth,
        timeout=60,
        params={"$top": 2, "$orderby": "Date desc"},
        headers={"Accept": "application/json"},
    )
    if r_sample.status_code == 200:
        sample = r_sample.json().get("value") or []
        w(f"sample tasks: {len(sample)}")
        if sample:
            sample_keys = sorted(sample[0].keys())
            executor_fields = [
                k
                for k in sample_keys
                if "сполн" in k.lower() or "executor" in k.lower() or k.endswith("_Key")
            ]
            w(f"executor-related keys: {executor_fields[:20]}")
            for k in sample_keys:
                if "исполн" in k.lower() or k == "Исполнитель":
                    w(f"  sample {k} = {sample[0].get(k)!r}")
    else:
        w(r_sample.text[:300])

    r_open = httpx.get(
        f"{base}/{task_ent}",
        auth=auth,
        timeout=120,
        params={"$top": 300, "$orderby": "Date desc", "$filter": "Executed eq false"},
        headers={"Accept": "application/json"},
    )
    w(f"OData open scan (300): HTTP {r_open.status_code}")
    odata_hits: list[dict] = []
    if r_open.status_code == 200:
        for row in r_open.json().get("value") or []:
            blob = str(row)
            if surname in blob or fio in blob:
                odata_hits.append(row)
        w(f"rows mentioning FIO/surname: {len(odata_hits)}")
        for i, row in enumerate(odata_hits[:20], 1):
            title = row.get("Description") or row.get("Наименование") or "—"
            w(f"  {i}. [{row.get('Number')}] {str(title)[:65]}")
    else:
        w(r_open.text[:300])

    # Try OData filters on executor field names from metadata
    user_key = ""
    if v8:
        cur2 = erp_sql._connect()
        try:
            c2 = cur2.cursor()
            c2.execute(
                """
                SELECT TOP 1 CONVERT(varchar(36), _IDRRef, 1)
                FROM dbo._Reference366 WITH (NOLOCK)
                WHERE LTRIM(RTRIM(_Description)) = ?
                """,
                (fio,),
            )
            r = c2.fetchone()
            if r:
                # 1C OData guid format
                hexref = str(r[0] or "").replace("0x", "").strip()
                if len(hexref) == 32:
                    user_key = f"{hexref[:8]}-{hexref[8:12]}-{hexref[12:16]}-{hexref[16:20]}-{hexref[20:]}"
                    w(f"SQL Ref_Key as GUID: {user_key}")
        finally:
            cur2.close()

    if user_key:
        filters = [
            f"Executed eq false and Исполнитель_Key eq guid'{user_key}'",
            f"Executed eq false and Исполнитель eq cast(guid'{user_key}','Catalog_Пользователи')",
        ]
        for filt in filters:
            r_f = httpx.get(
                f"{base}/{task_ent}",
                auth=auth,
                timeout=60,
                params={"$top": 30, "$filter": filt, "$orderby": "Date desc"},
                headers={"Accept": "application/json"},
            )
            w(f"filter [{filt[:70]}...]: HTTP {r_f.status_code}")
            if r_f.status_code == 200:
                items = r_f.json().get("value") or []
                w(f"  count={len(items)}")
                for i, row in enumerate(items[:10], 1):
                    w(f"  {i}. [{row.get('Number')}] {str(row.get('Description') or '')[:60]}")
            else:
                w(f"  {r_f.text[:200]}")

    w("")
    w("--- 8. Summary ---")
    try:
        final = list_current_tasks(fio=fio, user_id=v8.id if v8 else "", limit=100)
        open_final = [t for t in (final.get("tasks") or []) if not t.get("done")]
    except Exception:
        open_final = []

    w(f"list_current_tasks open count: {len(open_final)}")
    w(f"SQL by-ref open collected: {len(all_open)}")
    w(f"OData scan hits: {len(odata_hits)}")

    w("")
    w("NUMBERED OPEN TASKS (dedupe by number):")
    merged: dict[str, dict] = {}
    for t in open_final + all_open:
        num = str(t.get("number") or t.get("Number") or "").strip()
        if not num:
            continue
        merged[num] = t
    if not merged:
        w("  (нет открытых задач — 0)")
    else:
        for i, (num, t) in enumerate(sorted(merged.items(), key=lambda x: x[0]), 1):
            w(task_line(i, t))

    OUT.write_text(buf.getvalue(), encoding="utf-8")
    print(buf.getvalue())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
