"""Клиент шлюза COM. Инструменты ходят сюда, а не поднимают COM сами."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from app.tools.ac.workers.base import BaseWorker
from app.tools.ac.workers.com_gateway import HOST, PORT
from app.tools.ac.workers.models import WorkerResult, WorkerTask

_START_LOCK = threading.Lock()


class GatewayError(RuntimeError):
    def __init__(self, error_type: str, message: str) -> None:
        super().__init__(message)
        self.error_type = error_type or "COM_FAILED"


def gateway_url() -> str:
    return os.environ.get("COM_GATEWAY_URL", f"http://{HOST}:{PORT}").rstrip("/")


def _desktop_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _healthy() -> bool:
    try:
        with urllib.request.urlopen(gateway_url() + "/health", timeout=0.4) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return False
    return isinstance(body, dict) and body.get("ok") is True


def _start_lock():
    global _START_LOCK
    if _START_LOCK is None:
        import threading

        _START_LOCK = threading.Lock()
    return _START_LOCK


def ensure_gateway() -> None:
    """Поднять один процесс шлюза, если его ещё нет."""
    if os.environ.get("COM_GATEWAY_OWNER") == "1":
        return
    if os.environ.get("COM_GATEWAY_URL"):
        return
    if _healthy():
        return
    with _START_LOCK:
        if _healthy():
            return
        log_dir = Path(os.environ.get("LOCALAPPDATA") or str(Path.home())) / "Constructor"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_handle = (log_dir / "com_gateway.log").open("a", encoding="utf-8")
        subprocess.Popen(
            [sys.executable, "-m", "app.tools.ac.workers.com_gateway"],
            cwd=str(_desktop_root()),
            env={**os.environ, "COM_GATEWAY_OWNER": "1"},
            stdout=log_handle,
            stderr=log_handle,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if _healthy():
            return
        time.sleep(0.2)
    raise GatewayError("GATEWAY_DOWN", "Шлюз COM не поднялся на 127.0.0.1:7821")


def call(lane: str, tool: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    """Отдать вызов в очередь шлюза и дождаться ответа."""
    if os.environ.get("COM_GATEWAY_OWNER") == "1":
        raise GatewayError("GATEWAY_RECURSION", "Шлюз вызвал сам себя")
    ensure_gateway()
    raw = json.dumps(
        {"lane": lane, "tool": tool, "input": payload, "timeout": timeout},
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        gateway_url() + "/v1/call",
        data=raw,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout + 5) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise GatewayError("GATEWAY_HTTP", f"Шлюз COM ответил {exc.code}") from exc
    except (OSError, urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
        raise GatewayError("GATEWAY_UNREACHABLE", f"Шлюз COM недоступен: {exc}") from exc
    if not isinstance(body, dict) or not body.get("ok"):
        message = ""
        if isinstance(body, dict):
            message = str(body.get("error_message") or "")
        raise GatewayError(
            str(body.get("error_type") or "COM_FAILED") if isinstance(body, dict) else "COM_FAILED",
            message or "Ошибка шлюза COM",
        )
    output = body.get("output")
    return output if isinstance(output, dict) else {}


class GatewayComWorker(BaseWorker):
    """Worker реестра: сам COM не трогает, сдаёт задачу в шлюз."""

    def __init__(self, lane: str) -> None:
        self._lane = lane

    def execute(self, task: WorkerTask) -> WorkerResult:
        try:
            output = call(self._lane, task.tool_name, task.input_data, float(task.timeout_seconds))
        except GatewayError as exc:
            return WorkerResult(
                task_id=task.task_id,
                ok=False,
                error_type=exc.error_type,
                error_message=str(exc),
            )
        return WorkerResult(task_id=task.task_id, ok=True, output_data=output)
