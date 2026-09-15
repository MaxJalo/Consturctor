# -*- coding: utf-8 -*-
"""Client-side scan OData open tasks for performer GUID (server filter unreliable)."""
import os
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
WORKSPACE = BACKEND.parent.parent
sys.path.insert(0, str(BACKEND))
for env_path in (WORKSPACE / ".env", BACKEND / ".env"):
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

import httpx
from app.config import settings

guid = str(uuid.UUID(bytes_le=bytes.fromhex("980E6CB31113810E11F1599041290A43")))
guid_upper = guid.upper()
base = settings.odata_base_url.rstrip("/")
auth = (settings.odata_username, settings.odata_password)
ent = "Task_\u0417\u0430\u0434\u0430\u0447\u0430\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f"

hits = []
skip = 0
page = 200
max_pages = 80  # up to 16000 open tasks
for page_i in range(max_pages):
    r = httpx.get(
        f"{base}/{ent}",
        auth=auth,
        timeout=180,
        params={
            "$top": page,
            "$skip": skip,
            "$filter": "Executed eq false and DeletionMark eq false",
            "$orderby": "Date desc",
            "$select": "Number,Description,Date,Executed,\u0421\u0440\u043e\u043a\u0418\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f,\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c,\u0410\u0432\u0442\u043e\u0440",
        },
        headers={"Accept": "application/json"},
    )
    if r.status_code != 200:
        print("HTTP", r.status_code, r.text[:300])
        break
    batch = r.json().get("value") or []
    if not batch:
        print("done at skip", skip, "total hits", len(hits))
        break
    for row in batch:
        perf = row.get("\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c") or ""
        perf_s = str(perf).upper()
        if guid_upper in perf_s or guid.replace("-", "").upper() in perf_s:
            hits.append(row)
        # Author role
        auth_f = row.get("\u0410\u0432\u0442\u043e\u0440") or ""
        if guid_upper in str(auth_f).upper():
            hits.append({**row, "_role": "author"})
    skip += page
    if page_i % 10 == 0:
        print(f"page {page_i} skip={skip} hits={len(hits)}")
    if len(batch) < page:
        break

print("=== OPEN tasks for performer (client filter) ===", len(hits))
seen = set()
for i, row in enumerate(hits, 1):
    num = row.get("Number")
    if num in seen:
        continue
    seen.add(num)
    role = row.get("_role", "executor")
    print(
        i,
        num,
        role,
        row.get("Executed"),
        str(row.get("Description") or "")[:70],
        row.get("\u0421\u0440\u043e\u043a\u0418\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f"),
    )

# SQL: search open tasks where title/comment mentions user surname in task text (any performer)
from app.clients import erp_sql

conn = erp_sql._connect()
cur = conn.cursor()
cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")
cur.execute(
    """
SELECT TOP 30 CAST(t._Number AS nvarchar(32)), CAST(t._Name AS nvarchar(500)),
       CAST(u._Description AS nvarchar(256)), t._Executed
FROM dbo._Task39X1 t WITH (NOLOCK)
INNER JOIN dbo._Reference366 u ON t._Fld2503_RRRef = u._IDRRef
WHERE t._Marked=0x00 AND t._Executed=0x00
  AND (CAST(t._Name AS nvarchar(500)) LIKE N'%Жалыбин%'
       OR CAST(t._Fld2509 AS nvarchar(1000)) LIKE N'%Жалыбин%')
ORDER BY t._Date_Time DESC
"""
)
rows = cur.fetchall()
print("=== SQL open tasks mentioning Zhalybin in title/comment ===", len(rows))
for r in rows:
    print(r[0], r[3], str(r[1])[:50], "perf:", r[2])
conn.close()
