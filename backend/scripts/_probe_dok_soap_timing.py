"""Live timing for SOAP inbox. Does not print passwords."""

from __future__ import annotations

import sys
from dataclasses import replace
from datetime import date, datetime
from pathlib import Path
from time import perf_counter

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.tools.onec.dok_soap import (  # noqa: E402
    fetch_inbox,
    find_user,
    list_open_tasks,
    load_config,
    load_env_file,
)


def log(message: str) -> None:
    print(message, flush=True)


def main() -> int:
    fio = "Жалыбин Максим Дмитриевич"
    backend_env = load_env_file(BACKEND / ".env")
    desktop_env = load_env_file(BACKEND.parent / "desktop" / ".env")
    candidates = [
        ("ODATA", backend_env.get("ODATA_USERNAME", ""), backend_env.get("ODATA_PASSWORD", "")),
        ("ERP", desktop_env.get("ERP_LOGIN", ""), desktop_env.get("ERP_PASSWORD", "")),
    ]
    log(f"odata_base={backend_env.get('ODATA_BASE_URL', '')[:60]}")

    for label, username, password in candidates:
        if not username or not password:
            log(f"{label} skip empty")
            continue
        log(f"TRY {label} user_chars={len(username)}")
        try:
            cfg = replace(load_config(username=username, password=password), timeout=180.0)
        except Exception as exc:
            log(f"{label} config_fail {type(exc).__name__}: {exc}")
            continue
        log(f"{label} soap_url={cfg.soap_url()}")

        started = perf_counter()
        try:
            user = find_user(cfg, fio)
            log(
                f"{label} find_user_sec={perf_counter() - started:.2f} "
                f"name={user.get('name')}"
            )
        except Exception as exc:
            log(f"{label} find_user_fail_sec={perf_counter() - started:.2f} {type(exc).__name__}: {exc}")
            continue

        today = date.today()
        due_to = datetime.combine(today, datetime.max.time()).replace(microsecond=0)
        for mode, due in (("byUser+due", due_to), ("byUser", None)):
            started = perf_counter()
            try:
                rows = list_open_tasks(
                    cfg,
                    None,
                    timeout=180.0,
                    only_open=True,
                    user=user,
                    limit=80,
                    filter_mode="byUser",
                    due_to=due,
                )
                log(f"{label} {mode} ok_sec={perf_counter() - started:.2f} raw={len(rows)}")
            except Exception as exc:
                log(
                    f"{label} {mode} fail_sec={perf_counter() - started:.2f} "
                    f"{type(exc).__name__}: {exc}"
                )

        started = perf_counter()
        try:
            payload = fetch_inbox(
                cfg,
                fio,
                since_days=30,
                only_open=True,
                retrieve=False,
                today_and_overdue=True,
            )
            log(
                f"{label} inbox_today_overdue_sec={perf_counter() - started:.2f} "
                f"kept={payload.get('count')}"
            )
            for row in (payload.get("rows") or [])[:8]:
                due = str(row.get("due") or "—")[:19]
                title = str(row.get("description") or row.get("name") or "")[:90]
                log(f"  - {due} | {title}")
        except Exception as exc:
            log(
                f"{label} inbox_fail_sec={perf_counter() - started:.2f} "
                f"{type(exc).__name__}: {exc}"
            )
        return 0
    log("no credentials")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
