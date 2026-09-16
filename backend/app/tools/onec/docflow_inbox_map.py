"""Map colleague SOAP/HTTP inbox rows to orchestrator docflow task dicts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.erp_tasks import from_1c_datetime, task_is_late


def _parse_due(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text or text.startswith("0001-01-01"):
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", ""))
    except ValueError:
        return None
    return from_1c_datetime(parsed) or parsed


def map_inbox_row(row: dict[str, Any], *, fio: str) -> dict[str, Any]:
    """SOAP inbox row keys: description, step, due, begin, author, name, target."""
    title = " ".join(
        str(row.get("description") or row.get("target") or row.get("name") or "").split()
    )
    due = _parse_due(row.get("due"))
    created = _parse_due(row.get("begin"))
    done = bool(row.get("executed"))
    author = str(row.get("author") or "").strip()
    step = str(row.get("step") or "").strip()
    target = str(row.get("target") or "").strip()
    comment_parts = [part for part in (author, step, target) if part]
    performer = str(row.get("performer") or "").strip() or fio
    return {
        "number": str(row.get("number") or row.get("id") or "").strip(),
        "title": title,
        "status": "выполнена" if done else "открыта",
        "done": done,
        "late": task_is_late(done=done, completed_at=None, due_at=due),
        "created_at": created.isoformat(sep=" ") if created else "",
        "due_at": due.isoformat(sep=" ") if due else "",
        "completed_at": "",
        "comment": "; ".join(comment_parts),
        "approval": step or ("завершена" if done else "не согласовано"),
        "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "performer": performer,
        "source": "документооборот",
        "ref_key": str(row.get("id") or "").strip(),
        "target_id": str(row.get("target_id") or "").strip(),
    }


def map_inbox_payload(payload: dict[str, Any], *, fio: str) -> list[dict[str, Any]]:
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    out: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            out.append(map_inbox_row(row, fio=fio))
    return out
