# -*- coding: utf-8 -*-
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402
from app.clients import erp_sql  # noqa: E402
from app.config import settings  # noqa: E402
from app.services.erp_tasks import _query_tasks  # noqa: E402

fio_cat = "Жалыбин Максим Дмитриевич"
rows = erp_sql.search_user_directory("Жалыбин", limit=20)
print("v8users search:", len(rows))
for r in rows:
    print(" ", getattr(r, "id", ""), repr(getattr(r, "fio", r)))

conn = erp_sql._connect()
cur = conn.cursor()
cur.execute(
    """
    SELECT CONVERT(varchar(36), _IDRRef, 1), CAST(_Description AS nvarchar(256))
    FROM dbo._Reference366 WHERE _Description LIKE N'%Жалыбин%'
    """
)
refs = cur.fetchall()
for r in refs:
    print("ref366", r[0], r[1])

rows_q = _query_tasks(fio=fio_cat, only_open=False, limit=10)
print("all tasks (incl done) catalog FIO:", len(rows_q))
for t in rows_q[:5]:
    print(" ", t.get("number"), t.get("status"), t.get("title")[:50])

ref_hex = "980E6CB31113810E11F1599041290A43"
b = bytes.fromhex(ref_hex)
guid = str(uuid.UUID(bytes_le=b))
print("guid_le", guid)

base = settings.odata_base_url.rstrip("/")
auth = (settings.odata_username, settings.odata_password)
task_ent = "Task_ЗадачаИсполнителя"
for filt in (
    f"Executed eq false and Исполнитель_Key eq guid'{guid}'",
    f"Исполнитель_Key eq guid'{guid}'",
):
    r = httpx.get(
        f"{base}/{task_ent}",
        auth=auth,
        timeout=60,
        params={"$top": 20, "$filter": filt, "$orderby": "Date desc"},
        headers={"Accept": "application/json"},
    )
    n = len(r.json().get("value") or []) if r.status_code == 200 else -1
    print("OData", filt[:55], r.status_code, n)
    if r.status_code == 200:
        for row in r.json().get("value") or []:
            print(
                " ",
                row.get("Number"),
                row.get("Executed"),
                str(row.get("Description") or "")[:55],
            )

conn.close()
