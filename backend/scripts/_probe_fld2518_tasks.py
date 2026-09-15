# -*- coding: utf-8 -*-
import os, sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
WORKSPACE = BACKEND.parent.parent
OUT = BACKEND.parent / "output" / "fld2518_tasks.txt"
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
fio = os.environ.get("MY_NAME", "")
lines = [f"User: {fio}", f"Ref: {ref.hex().upper()}", ""]

conn = erp_sql._connect()
cur = conn.cursor()
cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")

for label, col in (
    ("executor _Fld2503_RRRef", "_Fld2503_RRRef"),
    ("field _Fld2518_RRRef", "_Fld2518_RRRef"),
    ("field _Fld2510_RRRef", "_Fld2510_RRRef"),
    ("field _Fld2517_RRRef", "_Fld2517_RRRef"),
    ("field _Fld2519_RRRef", "_Fld2519_RRRef"),
):
    cur.execute(
        f"""
        SELECT CAST(t._Number AS nvarchar(32)), CAST(t._Name AS nvarchar(500)),
               t._Date_Time, t._Fld2515, t._Executed,
               CAST(u._Description AS nvarchar(256))
        FROM dbo._Task39X1 t WITH (NOLOCK)
        LEFT JOIN dbo._Reference366 u ON t._Fld2503_RRRef = u._IDRRef
        WHERE t._Marked=0x00 AND t._Executed=0x00 AND t.{col} = ?
        ORDER BY t._Date_Time DESC
        """,
        (ref,),
    )
    rows = cur.fetchall()
    lines.append(f"=== {label}: {len(rows)} open ===")
    for i, r in enumerate(rows, 1):
        due = from_1c_datetime(r[3]) if hasattr(r[3], "year") else r[3]
        created = from_1c_datetime(r[2]) if hasattr(r[2], "year") else r[2]
        st = "открыта" if r[4] in (b"\x00", 0) else "выполнена"
        lines.append(
            f"{i}. № {r[0]} — {r[1]} | срок: {due} | {st} | исполнитель SQL: {r[5]}"
        )
    lines.append("")

conn.close()
text = "\n".join(lines)
OUT.write_text(text, encoding="utf-8")
print(text)
