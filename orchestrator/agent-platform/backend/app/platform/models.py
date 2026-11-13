"""Список доступных моделей Cursor SDK с вариантами параметров и кешем."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from app.config import settings
from app.platform.configs import find_config

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 300.0
_lock = threading.Lock()
_cached_for = ""
_cached_at = 0.0
_cached_items: list[dict[str, Any]] = []

_FALLBACK_MODELS: list[dict[str, Any]] = [
    {
        "id": "grok-4.7",
        "displayName": "Grok 4.7",
        "description": "Быстрая основная модель по умолчанию",
        "parameters": [
            {
                "id": "reasoning_effort",
                "displayName": "Рассуждение",
                "values": [
                    {"value": "low", "displayName": "Низкое"},
                    {"value": "medium", "displayName": "Среднее"},
                    {"value": "high", "displayName": "Высокое"},
                    {"value": "xhigh", "displayName": "Максимум"},
                ],
            },
            {
                "id": "fast",
                "displayName": "Быстрый режим",
                "values": [
                    {"value": "true", "displayName": "Вкл"},
                    {"value": "false", "displayName": "Выкл"},
                ],
            },
        ],
        "variants": [],
    },
    {
        "id": "grok-4.6",
        "displayName": "Grok 4.6",
        "description": "Стабильная запасная модель",
        "parameters": [
            {
                "id": "reasoning_effort",
                "displayName": "Рассуждение",
                "values": [
                    {"value": "low", "displayName": "Низкое"},
                    {"value": "medium", "displayName": "Среднее"},
                    {"value": "high", "displayName": "Высокое"},
                    {"value": "xhigh", "displayName": "Максимум"},
                ],
            },
            {
                "id": "fast",
                "displayName": "Быстрый режим",
                "values": [
                    {"value": "true", "displayName": "Вкл"},
                    {"value": "false", "displayName": "Выкл"},
                ],
            }
        ],
        "variants": [],
    },
]


def _api_key() -> str:
    return (settings.cursor_api_key or os.environ.get("CURSOR_API_KEY") or "").strip()


def _models_script() -> Path | None:
    for config_id in ("02-plan-instruction", "03-plan-instruction"):
        config = find_config(config_id)
        if config is None:
            continue
        candidate = Path(config.path) / "models.mjs"
        if candidate.is_file():
            return candidate
    return None


def _normalize(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or item.get("model") or "").strip()
        if not model_id:
            continue
        out.append(
            {
                "id": model_id,
                "displayName": str(item.get("displayName") or model_id),
                "description": str(item.get("description") or ""),
                "parameters": item.get("parameters") if isinstance(item.get("parameters"), list) else [],
                "variants": item.get("variants") if isinstance(item.get("variants"), list) else [],
            }
        )
    return out


def _grok_catalog(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = {"grok-4.7", "grok-4.6"}
    order = ["grok-4.7", "grok-4.6"]
    by_id = {item.get("id"): item for item in items if str(item.get("id") or "") in allowed}
    result: list[dict[str, Any]] = []
    for model_id in order:
        item = by_id.get(model_id)
        if not item:
            fallback = next((row for row in _FALLBACK_MODELS if row["id"] == model_id), None)
            if fallback is not None:
                result.append(fallback)
            continue
        params = item.get("parameters") if isinstance(item.get("parameters"), list) else []
        by_param = {str(p.get("id") or ""): p for p in params if isinstance(p, dict)}
        effort = by_param.get("reasoning_effort")
        fast = by_param.get("fast")
        if not effort:
            effort = {
                "id": "reasoning_effort",
                "displayName": "Рассуждение",
                "values": [
                    {"value": "low", "displayName": "Низкое"},
                    {"value": "medium", "displayName": "Среднее"},
                    {"value": "high", "displayName": "Высокое"},
                    {"value": "xhigh", "displayName": "Максимум"},
                ],
            }
        if not fast:
            fast = {
                "id": "fast",
                "displayName": "Быстрый режим",
                "values": [{"value": "true", "displayName": "Вкл"}, {"value": "false", "displayName": "Выкл"}],
            }
        result.append(
            {
                **item,
                "parameters": [effort, fast],
                "variants": [],
            }
        )
    return result


def list_models(*, refresh: bool = False) -> dict[str, Any]:
    global _cached_for, _cached_at, _cached_items
    key = _api_key()
    key_hash = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12] if key else ""
    now = time.monotonic()
    with _lock:
        if not refresh and _cached_items and _cached_for == key_hash and now - _cached_at < _CACHE_TTL_SECONDS:
            return {"items": list(_cached_items), "source": "sdk"}

    script = _models_script()
    node = shutil.which("node") or "node"
    if key and script is not None:
        env = dict(os.environ)
        env["CURSOR_API_KEY"] = key
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        try:
            proc = subprocess.run(
                [node, str(script)],
                cwd=str(script.parent),
                env=env,
                capture_output=True,
                text=True,
                timeout=15,
                creationflags=flags,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                payload = json.loads(proc.stdout.strip())
                items = _grok_catalog(_normalize(payload.get("items") if isinstance(payload, dict) else payload))
                if items:
                    with _lock:
                        _cached_for = key_hash
                        _cached_at = time.monotonic()
                        _cached_items = items
                    return {"items": list(items), "source": "sdk"}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Cursor.models.list failed: %s", exc)

    return {"items": list(_grok_catalog(list(_FALLBACK_MODELS))), "source": "fallback"}
