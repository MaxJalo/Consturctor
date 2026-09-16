"""Probe onec.erp_tasks_current via HTTP on local vs LAN gateway (reads MY_* from workspace .env)."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BACKEND = Path(__file__).resolve().parents[1]


def load_env() -> None:
    for env_path in (ROOT / ".env", BACKEND / ".env"):
        if not env_path.is_file():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, _, value = raw.partition("=")
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip()


def probe(label: str, base: str) -> None:
    base = base.rstrip("/")
    print(f"\n=== {label} {base} ===")
    try:
        health = urllib.request.urlopen(f"{base}/health", timeout=8).read().decode()
        print("health:", health[:240])
    except Exception as exc:  # noqa: BLE001
        print("health FAIL:", exc)
        return

    fio = (os.environ.get("MY_NAME") or "").strip()
    password = (os.environ.get("MY_PASSWORD") or "").strip()
    name_mail = (os.environ.get("MY_NAME_MAIL") or "").strip()
    if not fio or not password:
        print("skip tools: MY_NAME/MY_PASSWORD missing in .env")
        return

    login_body = json.dumps({"fio": fio, "password": password, "client": "probe"}).encode()
    login_req = urllib.request.Request(
        f"{base}/api/v1/auth/login",
        data=login_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(login_req, timeout=45) as resp:
            login = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        print("login HTTP", exc.code, exc.read().decode()[:320])
        return

    token = login.get("access_token") or login.get("token")
    if not token and isinstance(login.get("tokens"), dict):
        token = login["tokens"].get("access_token")
    if not token:
        print("login ok but token missing; keys:", sorted(login.keys()))
        return

    args: dict[str, object] = {"fio": fio, "limit": 80, "password": password}
    if name_mail:
        args["username"] = name_mail
    invoke_body = json.dumps({"tool": "onec.erp_tasks_current", "arguments": args}).encode()
    invoke_req = urllib.request.Request(
        f"{base}/api/v1/tools/invoke",
        data=invoke_body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(invoke_req, timeout=90) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        print("invoke HTTP", exc.code, exc.read().decode()[:400])
        return

    result = data.get("result") if isinstance(data, dict) else {}
    if not isinstance(result, dict):
        print("unexpected invoke payload:", str(data)[:300])
        return
    tasks = result.get("tasks") or []
    print("invoke ok:", data.get("ok"), "source:", result.get("source"), "count:", len(tasks))
    summary = result.get("summary")
    if summary:
        print("summary:", str(summary)[:200])
    for task in tasks[:8]:
        if not isinstance(task, dict):
            continue
        number = task.get("number") or "?"
        title = str(task.get("title") or "")[:70]
        print(f"  [{number}] {title}")


def main() -> int:
    load_env()
    fio = (os.environ.get("MY_NAME") or "").strip()
    print("MY_NAME:", fio or "(missing)")
    probe("local", os.environ.get("PROBE_LOCAL", "http://127.0.0.1:7812"))
    probe("LAN", os.environ.get("PROBE_LAN", "http://192.168.1.157:7812"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
