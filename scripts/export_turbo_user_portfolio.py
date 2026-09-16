#!/usr/bin/env python3
"""Export TurboProject user portfolio JSON (same as turboproject.get_user_portfolio).

Env (workspace root or backend/.env):
  MY_NAME / TURBOPROJECT_EMPLOYEE — ФИО для фильтра портфеля
  MY_PASSWORD / TURBOPROJECT_PASSWORD — пароль TurboProject API
  TURBOPROJECT_EMAIL or MY_NAME_MAIL + @turbo-don.ru
  TURBOPROJECT_API_BASE — default http://192.168.1.236:8000

Run:
  cd orchestrator/backend && python ../scripts/export_turbo_user_portfolio.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ORCH_ROOT = SCRIPT_DIR.parent
BACKEND_ROOT = ORCH_ROOT / "backend"
WORKSPACE_ROOT = ORCH_ROOT.parent
OUTPUT_DIR = ORCH_ROOT / "output"
TURBO_DON_DOMAIN = "turbo-don.ru"


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, _, value = raw.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _resolve_email() -> str:
    direct = (os.environ.get("TURBOPROJECT_EMAIL") or "").strip()
    if direct:
        return direct
    slug = (os.environ.get("MY_NAME_MAIL") or os.environ.get("NAME_MAIL") or "").strip().lower()
    if slug:
        return f"{slug}@{TURBO_DON_DOMAIN}"
    return ""


def main() -> int:
    for env_path in (WORKSPACE_ROOT / ".env", BACKEND_ROOT / ".env"):
        _load_dotenv(env_path)

    os.environ.setdefault("TURBOPROJECT_API_BASE", "http://192.168.1.236:8000")

    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))

    from app.services.turboproject import TurboProjectError, get_user_portfolio  # noqa: WPS433

    employee = (
        os.environ.get("MY_NAME")
        or os.environ.get("TURBOPROJECT_EMPLOYEE")
        or os.environ.get("ERP_LOGIN")
        or ""
    ).strip()
    email = _resolve_email()
    password = (os.environ.get("MY_PASSWORD") or os.environ.get("TURBOPROJECT_PASSWORD") or "").strip()

    if not employee:
        print("Need MY_NAME or TURBOPROJECT_EMPLOYEE in .env", file=sys.stderr)
        return 2
    if not email or not password:
        print(
            "Need TURBOPROJECT_EMAIL or MY_NAME_MAIL (latin login) plus MY_PASSWORD",
            file=sys.stderr,
        )
        return 2

    args = {
        "employee": employee,
        "fio": employee,
        "email": email,
        "password": password,
        "limit": int(os.environ.get("TURBOPROJECT_PORTFOLIO_LIMIT") or "500"),
    }

    try:
        result = get_user_portfolio(args)
    except TurboProjectError as exc:
        print(f"TurboProject error: {exc}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    out_path = OUTPUT_DIR / f"turbo_portfolio_{stamp}.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    count = int(result.get("matched_projects_count") or 0)
    print(f"employee={employee} matched_projects={count}")
    print(f"written={out_path}")
    for item in (result.get("projects") or [])[:20]:
        name = item.get("project_name") or item.get("original_name") or item.get("file_id")
        print(f"  - {name}")
    if count > 20:
        print(f"  ... and {count - 20} more in JSON")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
