"""Docflow tasks via service OData (.env), not personal session."""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent.parent
sys.path.insert(0, str(BACKEND))

for env_path in (BACKEND / ".env", ROOT / ".env"):
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
    print("MY_NAME missing in .env")
    raise SystemExit(2)

from app.services.docflow_tasks import (  # noqa: E402
    DocflowError,
    _get,
    _USER_ENTITY,
    docflow_auth,
    docflow_base_url,
    docflow_configured,
    find_user_key,
    list_docflow_tasks,
)

print("docflow_url:", docflow_base_url())
print("service_odata_configured:", docflow_configured())
auth = docflow_auth(None)
print("using_service_account:", bool(auth and auth[0]))

try:
    key = find_user_key(fio, auth_args=None)
    print("user_ref_key:", key or "(not found by Description eq FIO)")
    if not key:
        data = _get(
            _USER_ENTITY,
            params={
                "$top": 10,
                "$filter": f"contains(Description,'Жалыбин')",
                "$select": "Ref_Key,Description",
            },
            auth_args=None,
        )
        for row in data.get("value") or []:
            if isinstance(row, dict):
                print("  catalog:", row.get("Description"), row.get("Ref_Key"))
    open_tasks = list_docflow_tasks(fio=fio, only_open=True, limit=40, auth_args=None)
    all_recent = list_docflow_tasks(fio=fio, only_open=False, limit=15, auth_args=None)
except DocflowError as exc:
    print("DocflowError:", exc)
    raise SystemExit(1)

print("fio:", fio)
print("open_tasks:", len(open_tasks))
for i, t in enumerate(open_tasks[:20], 1):
    print(
        f"{i}. [{t.get('number')}] {(t.get('title') or '')[:65]} | "
        f"срок={t.get('due_date') or '—'} | {t.get('status')}"
    )
if not open_tasks and all_recent:
    print("(no open; recent closed/sample:)")
    for i, t in enumerate(all_recent[:5], 1):
        print(
            f"  {i}. [{t.get('number')}] {(t.get('title') or '')[:55]} | {t.get('status')}"
        )
