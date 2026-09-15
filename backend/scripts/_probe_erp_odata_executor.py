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
cat = "Catalog_Пользователи"

filters = [
    f"Executed eq false and Исполнитель eq cast(guid'{guid}','{cat}')",
    f"Executed eq false and Исполнитель/Ref_Key eq guid'{guid}'",
]
for filt in filters:
    r = httpx.get(
        f"{base}/{ent}",
        auth=auth,
        timeout=90,
        params={"$top": 50, "$filter": filt, "$orderby": "Date desc"},
        headers={"Accept": "application/json"},
    )
    print("FILTER:", filt)
    print("HTTP", r.status_code)
    if r.status_code != 200:
        print(r.text[:350])
        continue
    items = r.json().get("value") or []
    print("count", len(items))
    for row in items[:15]:
        print(
            row.get("Number"),
            "Executed=",
            row.get("Executed"),
            str(row.get("Description") or row.get("Наименование") or "")[:55],
        )
