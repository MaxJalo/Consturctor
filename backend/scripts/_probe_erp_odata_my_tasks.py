# -*- coding: utf-8 -*-
"""Open tasks for MY_NAME via erp_pm OData (service odata.user)."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import quote

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent.parent
sys.path.insert(0, str(BACKEND))

for env_path in (ROOT / ".env", BACKEND / ".env"):
    if not env_path.is_file():
        continue
    for line in env_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, _, value = raw.partition("=")
        if key.strip() and key.strip() not in os.environ:
            os.environ[key.strip()] = value.strip()

fio = (os.environ.get("MY_NAME") or "").strip()
if not fio:
    raise SystemExit("MY_NAME missing")

import httpx  # noqa: E402
from app.config import settings  # noqa: E402

base = settings.odata_base_url.rstrip("/")
auth = (settings.odata_username, settings.odata_password)
task_ent = "Task_ЗадачаИсполнителя"
user_ent = "Catalog_Пользователи"

print("fio:", fio)
print("using erp_pm OData service account")

# 1) user key
safe = fio.replace("'", "''")
r_user = httpx.get(
    f"{base}/{user_ent}",
    auth=auth,
    timeout=60,
    params={"$top": 5, "$filter": f"Description eq '{safe}'"},
    headers={"Accept": "application/json"},
)
print("Catalog lookup:", r_user.status_code)
user_key = ""
if r_user.status_code == 200:
    for row in r_user.json().get("value") or []:
        if isinstance(row, dict) and row.get("Ref_Key"):
            user_key = str(row["Ref_Key"])
            print(" Ref_Key:", user_key, "Description:", row.get("Description"))
            break
else:
    print(" body:", r_user.text[:200])

if not user_key:
    r_like = httpx.get(
        f"{base}/{user_ent}",
        auth=auth,
        timeout=60,
        params={"$top": 10, "$filter": "contains(Description,'Жалыбин')"},
        headers={"Accept": "application/json"},
    )
    print("contains Жалыбин:", r_like.status_code)
    if r_like.status_code == 200:
        for row in r_like.json().get("value") or []:
            print(" ", row.get("Description"), row.get("Ref_Key"))

# 2) tasks — open for executor
if user_key:
    filt = (
        f"Executed eq false and "
        f"Исполнитель eq cast(guid'{user_key}','Catalog_Пользователи')"
    )
    r_tasks = httpx.get(
        f"{base}/{task_ent}",
        auth=auth,
        timeout=60,
        params={"$top": 30, "$orderby": "Date desc", "$filter": filt},
        headers={"Accept": "application/json"},
    )
    print("tasks filter:", r_tasks.status_code)
    if r_tasks.status_code == 200:
        items = r_tasks.json().get("value") or []
        print("open_tasks:", len(items))
        for i, row in enumerate(items[:20], 1):
            title = row.get("Description") or row.get("Subject") or row.get("Наименование") or "—"
            num = row.get("Number") or row.get("Code") or "?"
            date = row.get("Date") or row.get("Срок") or "—"
            print(f"{i}. [{num}] {str(title)[:70]} | {date}")
    else:
        print(r_tasks.text[:300])

# 3) sample tasks without filter (sanity)
r_sample = httpx.get(
    f"{base}/{task_ent}",
    auth=auth,
    timeout=60,
    params={"$top": 3, "$orderby": "Date desc"},
    headers={"Accept": "application/json"},
)
if r_sample.status_code == 200:
    sample = r_sample.json().get("value") or []
    print("sample tasks count:", len(sample))
    if sample:
        print("task keys:", sorted(sample[0].keys())[:25])
        for i, row in enumerate(sample[:5], 1):
            blob = str(row)[:400]
            if "Жалыбин" in blob or "zhalybin" in blob.lower():
                print("match in sample", i, row.get("Description"), row.get("Number"))

# open tasks without user filter (scan client-side)
r_open = httpx.get(
    f"{base}/{task_ent}",
    auth=auth,
    timeout=120,
    params={
        "$top": 200,
        "$orderby": "Date desc",
        "$filter": "Executed eq false",
    },
    headers={"Accept": "application/json"},
)
print("open scan:", r_open.status_code)
if r_open.status_code == 200:
    hits = []
    for row in r_open.json().get("value") or []:
        blob = str(row)
        if fio.split()[0] in blob or "Жалыбин" in blob:
            hits.append(row)
    print("open tasks mentioning surname:", len(hits))
    for i, row in enumerate(hits[:15], 1):
        title = row.get("Description") or row.get("ПредметСтрокой") or "—"
        print(f"{i}. [{row.get('Number')}] {str(title)[:65]}")
else:
    print(r_open.text[:250])
