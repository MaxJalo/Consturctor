# -*- coding: utf-8 -*-
import os
import sys
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

fio = (os.environ.get("MY_NAME") or "").strip()
pwd = (os.environ.get("MY_PASSWORD") or "").strip()

from app.services.docflow_tasks import list_docflow_tasks, docflow_base_url
from app.services.erp_assignments import _list_tasks, resolve_user

print("docflow URL:", docflow_base_url())
print("fio:", fio)

auth = {"fio": fio, "password": pwd} if pwd else None

for only_open in (True, False):
    try:
        tasks = list_docflow_tasks(
            fio=fio, only_open=only_open, limit=50, auth_args=auth
        )
        print(f"docflow only_open={only_open}: count={len(tasks)}")
        for i, t in enumerate(tasks[:20], 1):
            print(
                f"  {i}. [{t.get('number')}] {str(t.get('title') or '')[:65]} "
                f"| {t.get('due_at') or t.get('due') or '—'} | {t.get('status')}"
            )
    except Exception as exc:
        print(f"docflow only_open={only_open} ERROR:", exc)

print("--- erp_assignments _list_tasks ---")
try:
    u = resolve_user(fio)
    print("resolve_user ref_key:", u.get("ref_key"), "fio:", u.get("fio"))
except Exception as exc:
    print("resolve_user:", exc)

for only_open in (True, False):
    r = _list_tasks({"performer": fio, "only_open": only_open, "limit": 50})
    print(f"assignments tasks only_open={only_open}: count={r.get('count')} filter={r.get('filter')!r}")
    for i, t in enumerate((r.get("tasks") or [])[:15], 1):
        print(
            f"  {i}. [{t.get('number')}] {str(t.get('title') or '')[:55]} "
            f"done={t.get('done')} due={t.get('due')}"
        )
