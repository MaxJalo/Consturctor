# -*- coding: utf-8 -*-
import os, sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
WORKSPACE = BACKEND.parent.parent
OUT = BACKEND.parent / "output" / "task_responsible_search.txt"
sys.path.insert(0, str(BACKEND))
for env_path in (WORKSPACE / ".env", BACKEND / ".env"):
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

fio = os.environ.get("MY_NAME", "")
surname = fio.split()[0] if fio else "Жалыбин"
pat = f"%{fio}%"

from app.clients import erp_sql
from app.services.erp_tasks import from_1c_datetime

conn = erp_sql._connect()
cur = conn.cursor()
cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")

queries = [
    ("title/comment full FIO", pat),
    ("title/comment surname only", f"%{surname}%"),
]

lines = [f"Search for: {fio}", ""]
for label, pattern in queries:
    cur.execute(
        """
        SELECT CAST(t._Number AS nvarchar(32)), CAST(t._Name AS nvarchar(500)),
               CAST(u._Description AS nvarchar(256)), t._Fld2515, t._Executed
        FROM dbo._Task39X1 t
        LEFT JOIN dbo._Reference366 u ON t._Fld2503_RRRef = u._IDRRef
        WHERE t._Marked=0x00 AND t._Executed=0x00
          AND (CAST(t._Name AS nvarchar(500)) LIKE ?
               OR CAST(t._Fld2509 AS nvarchar(1000)) LIKE ?)
        ORDER BY t._Date_Time DESC
        """,
        (pattern, pattern),
    )
    rows = cur.fetchall()
    lines.append(f"=== {label}: {len(rows)} open ===")
    for i, r in enumerate(rows, 1):
        due = from_1c_datetime(r[3]) if hasattr(r[3], "year") else r[3]
        lines.append(
            f"{i}. № {r[0]} — {r[1]} | срок: {due} | открыта | исполнитель: {r[2]}"
        )
    lines.append("")

text = "\n".join(lines)
OUT.write_text(text, encoding="utf-8")
print(text)

conn.close()
