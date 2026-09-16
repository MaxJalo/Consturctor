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
from app.services.erp_tasks import from_1c_datetime

ref = bytes.fromhex("980E6CB31113810E11F1599041290A43")
conn = erp_sql._connect()
cur = conn.cursor()
cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")

cur.execute(
    """
SELECT CAST(t._Number AS nvarchar(32)), CAST(t._Name AS nvarchar(500)),
       t._Date_Time, t._Fld2515, t._Executed,
       CAST(u._Description AS nvarchar(256)),
       CAST(t._Fld2509 AS nvarchar(1000)), CAST(t._Fld2513 AS nvarchar(300))
FROM dbo._Task39X1 t WITH (NOLOCK)
INNER JOIN dbo._Reference366 u ON t._Fld2503_RRRef = u._IDRRef
WHERE t._Marked=0x00 AND t._Executed=0x00
  AND (CAST(t._Name AS nvarchar(500)) LIKE N'%Жалыбин%'
       OR CAST(t._Fld2509 AS nvarchar(1000)) LIKE N'%Жалыбин%')
"""
)
rows = cur.fetchall()
print("tasks mentioning Zhalybin (open):", len(rows))
for r in rows:
    print("number:", r[0])
    print("title:", r[1])
    print("due_raw:", r[3])
    print("executed:", r[4])
    print("performer:", r[5])
    print("comment:", (r[6] or "")[:200])
    print("approval:", r[7])

# Binary search: open tasks where any RRRef column equals user ref
cur.execute(
    """
SELECT c.name FROM sys.columns c
JOIN sys.objects o ON c.object_id = o.object_id
WHERE o.name = '_Task39X1' AND c.name LIKE '%RRRef%'
"""
)
cols = [r[0] for r in cur.fetchall()]
print("RRRef columns:", cols)
for col in cols:
    try:
        cur.execute(
            f"""
            SELECT COUNT(*) FROM dbo._Task39X1 WITH (NOLOCK)
            WHERE _Marked=0x00 AND _Executed=0x00 AND {col} = ?
            """,
            (ref,),
        )
        n = cur.fetchone()[0]
        if n:
            print(f"  {col}: {n} open tasks")
            cur.execute(
                f"""
                SELECT TOP 5 CAST(_Number AS nvarchar(32)), CAST(_Name AS nvarchar(500))
                FROM dbo._Task39X1 WITH (NOLOCK)
                WHERE _Marked=0x00 AND _Executed=0x00 AND {col} = ?
                ORDER BY _Date_Time DESC
                """,
                (ref,),
            )
            for hit in cur.fetchall():
                print("   ", hit[0], str(hit[1])[:60])
    except Exception as exc:
        print(f"  {col}: err {exc}")

conn.close()
