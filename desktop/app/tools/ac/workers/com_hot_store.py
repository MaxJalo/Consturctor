"""Последний непустой ответ COM, общий для экрана и агентов.

И экран, и агент читают почту и календарь через search_mail / read_calendar.
Снимок лежит в профиле пользователя. Пустой ответ и сбой COM не стирают его:
нет новых данных — остаётся то, что уже было прочитано.
"""

from __future__ import annotations

import json
import os
from hashlib import sha256
from pathlib import Path
from typing import Any

_KEPT_WARNING = "Новых данных нет, показаны последние известные."


def hot_dir() -> Path:
    override = os.environ.get("CONSTRUCTOR_COM_HOT", "").strip()
    if override:
        root = Path(override)
    else:
        local = os.environ.get("LOCALAPPDATA") or str(Path.home())
        root = Path(local) / "Constructor" / "com_hot"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _file(kind: str, key: str) -> Path:
    digest = sha256(f"{kind}\n{key}".encode("utf-8")).hexdigest()[:24]
    safe_kind = "".join(char if char.isalnum() else "-" for char in kind) or "com"
    return hot_dir() / f"{safe_kind}-{digest}.json"


def query_key(parts: dict[str, Any]) -> str:
    return json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)


def mail_query_key(input_data: dict[str, Any]) -> str:
    return query_key(
        {
            "folder": input_data.get("folder") or "",
            "query": input_data.get("query") or "",
            "days": input_data.get("days") or "",
            "mailbox": input_data.get("mailbox") or "",
            "owner_fio": input_data.get("owner_fio") or "",
            "date": input_data.get("date") or "",
            "date_from": input_data.get("date_from") or "",
            "date_to": input_data.get("date_to") or "",
        }
    )


def calendar_query_key(input_data: dict[str, Any]) -> str:
    owners = input_data.get("calendar_owners")
    if not isinstance(owners, list):
        owners = []
    names = sorted(str(item).strip().casefold() for item in owners if str(item).strip())
    return query_key(
        {
            "date_from": input_data.get("date_from") or "",
            "date_to": input_data.get("date_to") or "",
            "for_user": input_data.get("for_user") or "",
            "all_visible": bool(input_data.get("all_visible")),
            "include_own": bool(input_data.get("include_own")),
            "owners": names,
        }
    )


def load_hot(kind: str, key: str) -> dict[str, Any] | None:
    path = _file(kind, key)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _write(kind: str, key: str, payload: dict[str, Any]) -> None:
    path = _file(kind, key)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def retain_list(kind: str, key: str, payload: dict[str, Any], field: str) -> dict[str, Any]:
    """Сохранить непустой список. Пустой ответ того же запроса вернуть из снимка."""
    items = payload.get(field)
    if isinstance(items, list) and items:
        stored = dict(payload)
        stored.pop("kept", None)
        stored.pop("warning", None)
        _write(kind, key, stored)
        return payload
    saved = load_hot(kind, key)
    saved_items = saved.get(field) if isinstance(saved, dict) else None
    if not isinstance(saved_items, list) or not saved_items:
        return payload
    kept = dict(saved)
    kept["kept"] = True
    kept["warning"] = _KEPT_WARNING
    return kept


def kept_after_error(kind: str, key: str, exc: BaseException) -> dict[str, Any] | None:
    """Сбой COM: отдать последний снимок, если он есть. Иначе None — ошибку поднимают снаружи."""
    saved = load_hot(kind, key)
    if not isinstance(saved, dict):
        return None
    kept = dict(saved)
    kept["kept"] = True
    kept["warning"] = str(exc).strip() or _KEPT_WARNING
    return kept
