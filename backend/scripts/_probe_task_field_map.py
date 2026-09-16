# -*- coding: utf-8 -*-
import os, sys
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

ref = bytes.fromhex("980E6CB31113810E11F1599041290A43")
conn = erp_sql._connect()
cur = conn.cursor()
cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")

nums = ["000040259", "000040231", "000040230", "000040229"]
for num in nums:
    cur.execute(
        """
        SELECT CAST(_Number AS nvarchar(32)), CAST(_Name AS nvarchar(500)),
               _Fld2503_RRRef, _Fld2510_RRRef, _Fld2517_RRRef, _Fld2518_RRRef, _Fld2519_RRRef,
               _Executed, _Fld2513
        FROM dbo._Task39X1 WITH (NOLOCK)
        WHERE _Number LIKE ?
        """,
        (f"%{num}%",),
    )
    for r in cur.fetchall():
        print("TASK", r[0])
        print(" title:", r[1][:100])
        for i, col in enumerate(
            ("2503 exec", "2510", "2517", "2518", "2519"), start=2
        ):
            val = r[i]
            mark = " <-- USER" if val == ref else ""
            print(f"  _Fld{col}:", val.hex().upper() if val else None, mark)
        print(" executed:", r[7], "approval:", r[8])

# Map _Fld2518 via OData property names - sample one task ref_key
import httpx, uuid
from app.config import settings

base = settings.odata_base_url.rstrip("/")
auth = (settings.odata_username, settings.odata_password)
ent = "Task_\u0417\u0430\u0434\u0430\u0447\u0430\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f"
r = httpx.get(
    f"{base}/{ent}",
    auth=auth,
    timeout=60,
    params={"$top": 1, "$filter": "Number eq '00-\u041b-000040231'"},
    headers={"Accept": "application/json"},
)
print("OData sample HTTP", r.status_code)
if r.status_code == 200:
    row = (r.json().get("value") or [{}])[0]
    for k in sorted(row.keys()):
        if "2518" in k or "\u041e\u0442\u0432\u0435\u0442" in k or "\u0418\u0441\u043f\u043e\u043b" in k or "CRM" in k:
            print(k, "=", row.get(k))

conn.close()
