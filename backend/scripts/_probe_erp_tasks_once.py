"""One-off probe: list open ERP tasks for MY_NAME from workspace .env."""
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
if not fio:
    print("MY_NAME missing")
    raise SystemExit(2)

from app.services.erp_tasks import ErpTaskError, list_current_tasks  # noqa: E402

try:
    result = list_current_tasks(fio=fio, user_id="", limit=40)
except ErpTaskError as exc:
    print("ErpTaskError:", exc)
    raise SystemExit(1)
except Exception as exc:  # noqa: BLE001
    print("Error:", type(exc).__name__, exc)
    raise SystemExit(1)

tasks = result.get("tasks") or []
print("fio:", fio)
print("source:", result.get("source"))
print("count:", len(tasks))
print("summary:", result.get("summary"))
for index, task in enumerate(tasks[:25], start=1):
    title = str(task.get("title") or task.get("name") or "—")[:70]
    number = task.get("number") or task.get("id") or "?"
    due = task.get("due_date") or task.get("deadline") or "—"
    status = task.get("status") or task.get("state") or "—"
    print(f"{index}. [{number}] {title} | срок: {due} | {status}")
