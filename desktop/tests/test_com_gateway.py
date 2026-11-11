"""Разные очереди шлюза идут одновременно, одна очередь — по одному."""

from __future__ import annotations

import json
import threading
import time
import urllib.request

from app.tools.ac.workers.com_gateway import LaneGate, serve


def _post(port: int, lane: str) -> dict:
    raw = json.dumps({"lane": lane, "tool": "probe", "input": {}, "timeout": 5}).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/call",
        data=raw,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        body = json.loads(response.read().decode("utf-8"))
    assert isinstance(body, dict)
    return body


def test_outlook_does_not_wait_for_onec() -> None:
    def dispatch(lane: str, _tool: str, _payload: dict) -> dict:
        time.sleep(0.4)
        return {"ok": True, "output": {"lane": lane}}

    server = serve(dispatch, port=0)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        started = time.monotonic()
        results: list[dict] = []

        def run(lane: str) -> None:
            results.append(_post(port, lane))

        threads = [threading.Thread(target=run, args=(lane,)) for lane in ("outlook", "onec")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=3)
        elapsed = time.monotonic() - started
        assert elapsed < 0.7
        assert {item["output"]["lane"] for item in results} == {"outlook", "onec"}
    finally:
        server.shutdown()


def test_one_lane_runs_calls_one_by_one() -> None:
    current = {"n": 0, "max": 0}
    lock = threading.Lock()

    def dispatch(lane: str, _tool: str, _payload: dict) -> dict:
        with lock:
            current["n"] += 1
            current["max"] = max(current["max"], current["n"])
        time.sleep(0.2)
        with lock:
            current["n"] -= 1
        return {"ok": True, "output": {"lane": lane}}

    server = serve(dispatch, port=0)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        threads = [threading.Thread(target=_post, args=(port, "outlook")) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=3)
        assert current["max"] == 1
    finally:
        server.shutdown()


def test_lane_gate_object_is_the_queue() -> None:
    order: list[str] = []

    def dispatch(lane: str, tool: str, _payload: dict) -> dict:
        order.append(f"{lane}:{tool}")
        return {"ok": True, "output": {}}

    gate = LaneGate(dispatch)
    first = gate.submit("project", "msproject.build_plan", {}, 2)
    second = gate.submit("outlook", "outlook.search_mail", {}, 2)
    assert first["ok"] is True
    assert second["ok"] is True
    assert order == ["project:msproject.build_plan", "outlook:outlook.search_mail"]
