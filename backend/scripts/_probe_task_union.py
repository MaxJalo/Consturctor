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

user_ref = bytes.fromhex("980E6CB31113810E11F1599041290A43")
conn = erp_sql._connect()
cur = conn.cursor()
cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")

def descr(ref_bytes):
    if not ref_bytes or ref_bytes == bytes(16):
        return None
    cur.execute(
        "SELECT CAST(_Description AS nvarchar(256)) FROM dbo._Reference366 WHERE _IDRRef=?",
        (ref_bytes,),
    )
    r = cur.fetchone()
    return r[0] if r else "?"

cur.execute(
    """
SELECT CAST(_Number AS nvarchar(32)), CAST(_Name AS nvarchar(500)),
       _Fld2503_RRRef, _Fld2510_RRRef, _Fld2518_RRRef, _Executed
FROM dbo._Task39X1 WHERE _Number = N'00-Л-000040259'
"""
)
r = cur.fetchone()
print("259 title:", r[1])
print(" exec:", descr(r[2]))
print(" fld2510:", descr(r[3]))
print(" fld2518:", descr(r[4]))

for col in ("_Fld2510_RRRef", "_Fld2518_RRRef"):
    cur.execute(
        f"""
        SELECT COUNT(*) FROM dbo._Task39X1
        WHERE _Marked=0x00 AND _Executed=0x00 AND {col}=?
        """,
        (user_ref,),
    )
    print(f"open by {col}:", cur.fetchone()[0])

# Combined: executor OR fld2510 OR fld2518
cur.execute(
    """
SELECT CAST(t._Number AS nvarchar(32)), CAST(t._Name AS nvarchar(500)),
       CAST(u._Description AS nvarchar(256)), t._Fld2515
FROM dbo._Task39X1 t
LEFT JOIN dbo._Reference366 u ON t._Fld2503_RRRef = u._IDRRef
WHERE t._Marked=0x00 AND t._Executed=0x00
  AND (t._Fld2503_RRRef=? OR t._Fld2510_RRRef=? OR t._Fld2518_RRRef=?)
ORDER BY t._Date_Time DESC
""",
    (user_ref, user_ref, user_ref),
)
rows = cur.fetchall()
print("UNION executor|2510|2518 open:", len(rows))
for i, row in enumerate(rows, 1):
    print(i, row[0], row[1][:70], "| исп:", row[2], "| due:", row[3])

conn.close()
