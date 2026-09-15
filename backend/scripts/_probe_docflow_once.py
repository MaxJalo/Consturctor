"""Probe docflow tasks via backend service (OData)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

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
pwd = os.environ.get("MY_PASSWORD") or ""
if not fio:
    raise SystemExit("MY_NAME missing")

from app.services.docflow_tasks import DocflowError, docflow_configured, list_docflow_tasks  # noqa: E402

auth = {"username": fio, "password": pwd} if pwd else None
print("docflow_configured:", docflow_configured())
try:
    tasks = list_docflow_tasks(fio=fio, only_open=True, limit=30, auth_args=auth)
except DocflowError as exc:
    print("docflow error:", exc)
    raise SystemExit(1)
except Exception as exc:  # noqa: BLE001
    print("error:", type(exc).__name__, exc)
    raise SystemExit(1)

print("fio:", fio)
print("count:", len(tasks))
for index, task in enumerate(tasks[:25], start=1):
    title = str(task.get("title") or task.get("name") or "—")[:70]
    number = task.get("number") or "?"
    due = task.get("due_date") or task.get("deadline") or "—"
    print(f"{index}. [{number}] {title} | {due}")
