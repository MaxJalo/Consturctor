# -*- coding: utf-8 -*-
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402
from app.config import settings  # noqa: E402

guid = str(uuid.UUID(bytes_le=bytes.fromhex("980E6CB31113810E11F1599041290A43")))
base = settings.odata_base_url.rstrip("/")
auth = (settings.odata_username, settings.odata_password)
ent = "Task_ЗадачаИсполнителя"

filters = [
    f"Исполнитель_Key eq guid'{guid}' and Executed eq false",
    f"Исполнитель_Key eq guid'{guid}' and Executed eq true",
    f"Исполнитель_Key eq guid'{guid}'",
]
for filt in filters:
    r = httpx.get(
        f"{base}/{ent}",
        auth=auth,
        timeout=60,
        params={"$top": 50, "$filter": filt, "$orderby": "Date desc"},
        headers={"Accept": "application/json"},
    )
    print("===", filt)
    print("status", r.status_code)
    if r.status_code != 200:
        print(r.text[:200])
        continue
    items = r.json().get("value") or []
    print("count", len(items))
    open_n = sum(1 for x in items if x.get("Executed") is False)
    done_n = sum(1 for x in items if x.get("Executed") is True)
    print("Executed false/true in page", open_n, done_n)
    for row in items[:5]:
        print(
            row.get("Number"),
            "Executed=",
            row.get("Executed"),
            str(row.get("Description") or "")[:50],
        )
