"""Локальный шлюз COM. Снаружи один адрес, внутри три очереди.

Почта, MS Project и 1С не делят один замок: вызов 1С не держит чтение почты.
Внутри одной очереди по-прежнему один вызов, потому что сам COM-сервер один.
"""

from __future__ import annotations

import json
import os
import threading
from collections import deque
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from uuid import uuid4

HOST = "127.0.0.1"
PORT = 7821
LANES = ("outlook", "project", "onec")

Dispatch = Callable[[str, str, dict[str, Any]], dict[str, Any]]


class LaneGate:
    """Три очереди. Разные очереди идут одновременно, одна очередь — по одному."""

    def __init__(self, dispatch: Dispatch) -> None:
        self._dispatch = dispatch
        self._queues: dict[str, deque[dict[str, Any]]] = {lane: deque() for lane in LANES}
        self._wake: dict[str, threading.Condition] = {
            lane: threading.Condition() for lane in LANES
        }
        for lane in LANES:
            threading.Thread(target=self._loop, args=(lane,), name=f"com-{lane}", daemon=True).start()

    def submit(self, lane: str, tool: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
        if lane not in self._queues:
            return {"ok": False, "error_type": "UNKNOWN_LANE", "error_message": f"Неизвестная очередь COM: {lane}"}
        job: dict[str, Any] = {
            "tool": tool,
            "input": payload,
            "done": threading.Event(),
            "result": None,
        }
        wake = self._wake[lane]
        with wake:
            self._queues[lane].append(job)
            wake.notify()
        if not job["done"].wait(timeout):
            return {
                "ok": False,
                "error_type": "GATEWAY_TIMEOUT",
                "error_message": f"Шлюз COM не ответил за {int(timeout)} с ({lane})",
            }
        result = job["result"]
        if isinstance(result, dict):
            return result
        return {"ok": False, "error_type": "GATEWAY_ERROR", "error_message": "Пустой ответ шлюза"}

    def _loop(self, lane: str) -> None:
        wake = self._wake[lane]
        pending = self._queues[lane]
        while True:
            with wake:
                while not pending:
                    wake.wait()
                job = pending.popleft()
            try:
                job["result"] = self._dispatch(lane, str(job["tool"]), dict(job["input"]))
            except Exception as exc:  # noqa: BLE001 — ответ клиенту, а не падение очереди
                job["result"] = {
                    "ok": False,
                    "error_type": "GATEWAY_ERROR",
                    "error_message": str(exc),
                }
            job["done"].set()


def local_dispatch(lane: str, tool: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Выполнить вызов уже внутри процесса шлюза. Сюда COM и входит."""
    os.environ["COM_GATEWAY_OWNER"] = "1"
    if lane == "project":
        return _project(tool, payload)
    if lane == "outlook":
        return _worker_call("outlook", tool, payload)
    if lane == "onec":
        return _worker_call("onec", tool, payload)
    return {"ok": False, "error_type": "UNKNOWN_LANE", "error_message": lane}


def _project(tool: str, payload: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ac.workers import msproject_com_actions

    actions = {
        "msproject.build_plan": msproject_com_actions.build_plan,
        "msproject.template_outline": msproject_com_actions.template_outline,
        "msproject.open_file": msproject_com_actions.open_file,
    }
    action = actions.get(tool)
    if action is None:
        return {"ok": False, "error_type": "UNKNOWN_COM_TOOL", "error_message": tool}
    output = action(payload)
    if not isinstance(output, dict):
        output = {}
    if output.get("ok"):
        return {"ok": True, "output": output}
    return {
        "ok": False,
        "error_type": "MSPROJECT_FAILED",
        "error_message": str(output.get("error") or "Ошибка MS Project"),
        "output": output,
    }


def _worker_call(lane: str, tool: str, payload: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ac.workers.models import WorkerTask
    from app.tools.ac.workers.onec_worker import OneCComWorker
    from app.tools.ac.workers.outlook_com_worker import OutlookComWorker

    task = WorkerTask(task_id=uuid4().hex, tool_name=tool, input_data=payload, timeout_seconds=180)
    if lane == "onec":
        result = OneCComWorker().execute(task)
    else:
        result = OutlookComWorker(safe_mode=True, allow_direct_com_calls=True).execute(task)
    if result.ok:
        return {"ok": True, "output": result.output_data or {}}
    return {
        "ok": False,
        "error_type": result.error_type or "COM_FAILED",
        "error_message": result.error_message or "Ошибка COM",
        "output": result.output_data or {},
    }


class _Handler(BaseHTTPRequestHandler):
    gate: LaneGate

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/health":
            self._send(404, {"ok": False, "error_message": "Неизвестный путь"})
            return
        self._send(200, {"ok": True, "lanes": list(LANES)})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/v1/call":
            self._send(404, {"ok": False, "error_message": "Неизвестный путь"})
            return
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self._send(400, {"ok": False, "error_type": "BAD_REQUEST", "error_message": "Нужен JSON"})
            return
        if not isinstance(body, dict):
            self._send(400, {"ok": False, "error_type": "BAD_REQUEST", "error_message": "Нужен объект"})
            return
        lane = str(body.get("lane") or "")
        tool = str(body.get("tool") or "")
        payload = body.get("input") if isinstance(body.get("input"), dict) else {}
        timeout = float(body.get("timeout") or 180)
        self._send(200, self.gate.submit(lane, tool, payload, timeout))

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def serve(dispatch: Dispatch, host: str = HOST, port: int = PORT) -> ThreadingHTTPServer:
    gate = LaneGate(dispatch)
    _Handler.gate = gate
    server = ThreadingHTTPServer((host, port), _Handler)
    server.gate = gate  # type: ignore[attr-defined]
    return server


def main() -> None:
    os.environ["COM_GATEWAY_OWNER"] = "1"
    server = serve(local_dispatch)
    server.serve_forever()


if __name__ == "__main__":
    main()
