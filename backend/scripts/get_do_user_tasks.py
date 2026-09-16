#!/usr/bin/env python3
"""Открытые задачи пользователя из 1С:Документооборота (HTTP SOAP dm.1cws).

  python scripts/get_do_user_tasks.py "Жалыбин Максим Дмитриевич"
  python scripts/get_do_user_tasks.py "Комарькова Анастасия Эдуардовна" -o tasks.json
  python scripts/get_do_user_tasks.py "Жалыбин Максим Дмитриевич" --env-file D:\\secrets\\dok.env
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.tools.onec.dok_soap import main

if __name__ == "__main__":
    raise SystemExit(main())
