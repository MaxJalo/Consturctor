# -*- coding: utf-8 -*-
import os, sys, uuid
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

from app.clients import erp_sql
import httpx
from app.config import settings

ref = bytes.fromhex("980E6CB31113810E11F1599041290A43")
guid = str(uuid.UUID(bytes_le=ref))
conn = erp_sql._connect()
cur = conn.cursor()
cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")

cur.execute(
    """
SELECT TOP 20 CAST(t._Number AS nvarchar(32)), CAST(t._Name AS nvarchar(500)),
       CAST(u._Description AS nvarchar(256)), t._Executed
FROM dbo._Task39X1 t WITH (NOLOCK)
INNER JOIN dbo._Reference366 u ON t._Fld2503_RRRef = u._IDRRef
WHERE t._Marked=0x00 AND t._Executed=0x00 AND u._Description LIKE N'%Жалыбин%'
ORDER BY t._Date_Time DESC
"""
)
rows = cur.fetchall()
print("SQL open tasks performer LIKE Zhalybin:", len(rows))
for r in rows:
    print(" ", r[0], r[3], str(r[1])[:50], r[2])

cur.execute(
    """
SELECT COUNT(*) FROM dbo._Task39X1 t
INNER JOIN dbo._Reference366 u ON t._Fld2503_RRRef = u._IDRRef
INNER JOIN dbo.v8users v ON LTRIM(RTRIM(u._Description)) =
    LTRIM(RTRIM(COALESCE(NULLIF(v.Descr,N''), v.Name)))
WHERE t._Marked=0x00 AND CONVERT(varchar(64), v.ID, 2) = ?
""",
    ("885434321E82D8094E17EAE8D9276D36",),
)
print("all tasks v8 join count:", cur.fetchone()[0])

cur.execute(
    """
SELECT COUNT(*) FROM dbo._Task39X1 t
INNER JOIN dbo._Reference366 u ON t._Fld2503_RRRef = u._IDRRef
INNER JOIN dbo.v8users v ON LTRIM(RTRIM(u._Description)) =
    LTRIM(RTRIM(COALESCE(NULLIF(v.Descr,N''), v.Name)))
WHERE t._Marked=0x00 AND t._Executed=0x00 AND CONVERT(varchar(64), v.ID, 2) = ?
""",
    ("885434321E82D8094E17EAE8D9276D36",),
)
print("open tasks v8 join count:", cur.fetchone()[0])

# Other catalog refs for same user name
cur.execute(
    """
SELECT TOP 5 CONVERT(varchar(36), _IDRRef, 1), CAST(_Description AS nvarchar(256))
FROM dbo._Reference366 WITH (NOLOCK)
WHERE _Description LIKE N'%Жалыбин%Максим%'
"""
)
print("Reference366 Zhalybin rows:")
for r in cur.fetchall():
    print(" ", r)

conn.close()

base = settings.odata_base_url.rstrip("/")
auth = (settings.odata_username, settings.odata_password)
ent = "Task_\u0417\u0430\u0434\u0430\u0447\u0430\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f"
cat = "Catalog_\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438"
filt = f"\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c eq cast(guid'{guid}','{cat}')"
r = httpx.get(
    f"{base}/{ent}",
    auth=auth,
    timeout=120,
    params={"$top": 100, "$filter": filt},
    headers={"Accept": "application/json"},
)
print("OData executor no orderby HTTP", r.status_code)
if r.status_code == 200:
    items = r.json().get("value") or []
    print("count", len(items))
    open_items = [x for x in items if not x.get("Executed")]
    print("Executed=false in response", len(open_items))
    for row in open_items[:15]:
        print(
            " OPEN",
            row.get("Number"),
            str(row.get("Description") or "")[:60],
            row.get("\u0421\u0440\u043e\u043a\u0418\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f"),
        )
    if not open_items and items:
        print("sample done tasks:", len(items))
        for row in items[:3]:
            print(" ", row.get("Number"), row.get("Executed"))
else:
    print(r.text[:400])

# Docflow with odata.user
doc_base = settings.docflow_odata_base_url.rstrip("/")
r2 = httpx.get(
    f"{doc_base}/{ent}",
    auth=auth,
    timeout=60,
    params={"$top": 5},
    headers={"Accept": "application/json"},
)
print("docflow ping HTTP", r2.status_code, r2.text[:200] if r2.status_code != 200 else "OK")

# erp_assignments path
from app.services import erp_assignments

try:
    res = erp_assignments.list_assignments_for_user(fio=os.environ.get("MY_NAME", ""), limit=30)
    print("erp_assignments count", res.get("count"), res.get("summary"))
    for t in (res.get("tasks") or res.get("items") or [])[:10]:
        print(" ", t)
except Exception as exc:
    print("erp_assignments error", exc)
