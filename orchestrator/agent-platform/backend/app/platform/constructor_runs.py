"""Синхронизация запусков платформы с таблицей agent_runs в backend Constructor."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.config import settings
from app.platform.sessions import PlatformSession, SessionEvent
from app.tools.constructor_session import _given_token

logger = logging.getLogger(__name__)

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_SYNC_TIMEOUT_S = 60.0
_MCP_PREFIX_RE = re.compile(r"^(?:custom-user-tools|turbotester|constructor)[-_.]+", re.I)


def is_constructor_workflow(workflow_id: str) -> bool:
    return bool(_UUID_RE.fullmatch((workflow_id or "").strip()))


def _headers() -> dict[str, str] | None:
    token = _given_token()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _base_url() -> str:
    return (settings.constructor_api_url or "").strip().rstrip("/")


def fetch_agent_skill_markdown(skill_id: str) -> str:
    """Текст умения из общего банка. Пустая строка, если записи нет или нет доступа."""
    headers = _headers()
    base = _base_url()
    if not headers or not base:
        return ""
    response = httpx.get(f"{base}/api/v1/agent-skills/{skill_id}", headers=headers, timeout=15)
    if response.status_code != 200:
        return ""
    payload = response.json()
    return str(payload.get("content") or "") if isinstance(payload, dict) else ""


def _tool_name(event: SessionEvent) -> str:
    if event.name != "mcp":
        return event.name
    try:
        args = json.loads(event.args or "{}")
    except ValueError:
        return event.name
    if isinstance(args, dict):
        raw = str(args.get("toolName") or "").strip()
        if raw:
            return _MCP_PREFIX_RE.sub("", raw).replace("__", ".")
    return event.name


def _parse_json(raw: str) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def _extract_mcp_result(raw: str) -> Any:
    parsed = _parse_json(raw)
    if not isinstance(parsed, dict):
        return parsed
    value = parsed.get("value")
    if isinstance(value, dict) and isinstance(value.get("content"), list):
        texts = []
        for item in value["content"]:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                texts.append(item["text"])
        joined = "\n".join(texts).strip()
        if joined:
            return _parse_json(joined)
    return parsed


def _turn_events(session: PlatformSession, turn: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for event in session.events:
        if event.turn != turn or event.parent:
            continue
        if event.type == "user":
            if event.text:
                out.append({"type": "user_message", "text": event.text})
        elif event.type == "thinking":
            if event.text:
                out.append({"type": "thinking", "text": event.text})
        elif event.type == "assistant":
            if event.text:
                out.append({"type": "assistant", "text": event.text})
        elif event.type == "tool":
            args_obj = _parse_json(event.args)
            if event.name == "mcp" and isinstance(args_obj, dict) and "args" in args_obj:
                args_obj = args_obj.get("args")
            item: dict[str, Any] = {
                "type": "tool_call",
                "tool": _tool_name(event),
                "requestId": event.call_id,
                "status": event.status or "running",
            }
            if args_obj is not None:
                item["arguments"] = args_obj
            if event.result:
                item["result"] = _extract_mcp_result(event.result) if event.name == "mcp" else _parse_json(event.result)
            out.append(item)
        elif event.type == "error":
            out.append({"type": "error", "message": event.text})
        elif event.type == "status" and event.text:
            out.append({"type": "status", "text": event.text})
    return out


def start_run(session: PlatformSession, prompt: str) -> str:
    if not is_constructor_workflow(session.workflow_id):
        return ""
    base = _base_url()
    headers = _headers()
    if not base or not headers:
        return ""
    try:
        with httpx.Client(timeout=_SYNC_TIMEOUT_S, trust_env=False) as client:
            response = client.post(
                f"{base}/api/v1/workflows/{session.workflow_id}/runs/local",
                headers=headers,
                json={
                    "message": prompt,
                    "source": "chat",
                    "conversation_key": session.conversation_key,
                },
            )
        if response.status_code >= 400:
            logger.warning("agent_runs start skipped (%s): %s", response.status_code, response.text[:300])
            return ""
        data = response.json()
        return str(data.get("id") or "")
    except Exception as exc:  # noqa: BLE001
        logger.warning("agent_runs start failed: %s", exc)
        return ""


def flush_events(session: PlatformSession, run_id: str, turn: int) -> None:
    if not run_id or not is_constructor_workflow(session.workflow_id):
        return
    base = _base_url()
    headers = _headers()
    if not base or not headers:
        return
    events = _turn_events(session, turn)
    if not events:
        return
    try:
        with httpx.Client(timeout=_SYNC_TIMEOUT_S, trust_env=False) as client:
            client.patch(
                f"{base}/api/v1/workflows/{session.workflow_id}/runs/{run_id}/events",
                headers=headers,
                json={"events": events},
            )
    except Exception:  # noqa: BLE001
        pass


def finish_run(session: PlatformSession, run_id: str, turn: int, status: str, error: str = "") -> None:
    if not run_id or not is_constructor_workflow(session.workflow_id):
        return
    base = _base_url()
    headers = _headers()
    if not base or not headers:
        return
    events = _turn_events(session, turn)
    user_text = next((e.text for e in session.events if e.turn == turn and e.type == "user" and not e.parent), "")
    answer_parts = [e.text for e in session.events if e.turn == turn and e.type == "assistant" and not e.parent and e.text]
    answer = "".join(answer_parts).strip()
    if not answer and error:
        answer = error
    mapped_status = "ok" if status == "finished" else "canceled" if status == "cancelled" else "error"
    try:
        with httpx.Client(timeout=_SYNC_TIMEOUT_S, trust_env=False) as client:
            response = client.post(
                f"{base}/api/v1/workflows/{session.workflow_id}/runs/{run_id}/finish",
                headers=headers,
                json={
                    "status": mapped_status,
                    "answer": answer,
                    "events": events,
                    "message": user_text,
                    "sdk_agent_id": session.sdk_agent_id,
                },
            )
        if response.status_code >= 400:
            logger.warning("agent_runs finish returned %s: %s", response.status_code, response.text[:300])
    except Exception as exc:  # noqa: BLE001
        logger.warning("agent_runs finish failed: %s", exc)


def fetch_conversation_runs(workflow_id: str, conversation_key: str, *, limit: int = 20) -> list[dict[str, Any]]:
    if not is_constructor_workflow(workflow_id) or not conversation_key.strip():
        return []
    base = _base_url()
    headers = _headers()
    if not base or not headers:
        return []
    try:
        with httpx.Client(timeout=20.0, trust_env=False) as client:
            response = client.get(
                f"{base}/api/v1/workflows/{workflow_id}/runs",
                headers=headers,
                params={"conversation_key": conversation_key, "limit": limit, "include_events": "true"},
            )
        if response.status_code >= 400:
            return []
        payload = response.json()
        items = payload.get("items") if isinstance(payload, dict) else payload
        return list(items) if isinstance(items, list) else []
    except Exception as exc:  # noqa: BLE001
        logger.warning("fetch_conversation_runs failed: %s", exc)
        return []
