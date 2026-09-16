"""ERP OData (service account) — task entities and user lookup."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402
from app.config import settings  # noqa: E402

base = settings.odata_base_url.rstrip("/")
auth = (settings.odata_username, settings.odata_password)
fio = "Жалыбин Максим Димитриевич"

entities = [
    "Task_ЗадачаИсполнителя",
    "Catalog_Пользователи",
    "Catalog_Users",
]

print("erp_odata:", base)
for ent in entities:
    url = f"{base}/{ent}"
    r = httpx.get(url, auth=auth, timeout=30, params={"$top": 1}, headers={"Accept": "application/json"})
    print(f"{ent}: HTTP {r.status_code}")

# find user in erp catalog if exists
cat = "Catalog_Пользователи"
filt = f"Description eq '{fio.replace(chr(39), chr(39)+chr(39))}'"
r = httpx.get(
    f"{base}/{cat}",
    auth=auth,
    timeout=30,
    params={"$top": 5, "$filter": filt},
    headers={"Accept": "application/json"},
)
print("user lookup:", r.status_code)
if r.status_code == 200:
    for row in (r.json().get("value") or [])[:3]:
        print(" ", row.get("Description"), row.get("Ref_Key"))
