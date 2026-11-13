"""Tests for unified Cursor chat harness on agent-platform."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.platform.approvals import chat_allowed, classify, confirm_action
from app.platform.sessions import store
from app.skills.registry import list_skills, load_catalog as load_skills, materialize_skills
from app.tools.registry import get_tool, load_catalog as load_tools


def test_real_hitl_blocks_writes_and_allows_reads_and_case_tool() -> None:
    load_tools()
    assert confirm_action("write", {"path": "foo.txt"}) is False

    assert classify("read", {"path": "foo.txt"}) is None
    assert classify("shell", {"command": "ls -la"}) is None
    assert (
        classify(
            "shell",
            {"command": "python -c \"import json; d=json.load(open(r'tool_results/result_1.json', encoding='utf-8')); print(list(d))\""},
        )
        is None
    )
    assert classify("mcp:custom-user-tools/ask_user", {"questions": []}) is None
    assert (
        classify(
            "mcp:custom-user-tools/external_order__case",
            {"toolName": "external_order__case", "args": {"action": "auto_prepare", "order_id": "1"}},
        )
        is None
    )

    shell_req = classify("shell", {"command": "rm -rf build"})
    assert shell_req is not None and shell_req.kind == "shell"

    write_req = classify("write", {"path": "out.txt", "content": "hi"})
    assert write_req is not None and write_req.kind == "write"

    onec_write_req = classify(
        "mcp:custom-user-tools/onec__meeting_protocol_write",
        {"toolName": "onec__meeting_protocol_write", "args": {"action": "create"}},
    )
    assert onec_write_req is not None and onec_write_req.kind == "mcp"
    assert chat_allowed(
        "mcp:custom-user-tools/onec__meeting_protocol_write",
        {"toolName": "onec__meeting_protocol_write", "args": {"action": "create"}},
    )
    assert chat_allowed(
        "mcp:custom-user-tools/outlook__ews_create_meeting",
        {"toolName": "outlook__ews_create_meeting", "args": {}},
    )
    assert chat_allowed("shell", {"command": "rm -rf build"}) is False
    assert chat_allowed("write", {"path": "out.txt", "content": "hi"}) is False


def test_skills_and_external_order_tool_loaded(tmp_path: Path) -> None:
    load_tools()
    load_skills()
    skills = list_skills()
    skill_ids = {s.id for s in skills}
    assert {"external-order-case", "personal-assistant", "meeting-protocol"} <= skill_ids
    assert {
        "order-ks",
        "order-development",
        "order-rp",
        "order-committee",
        "order-kb",
        "order-omto",
        "order-finance",
        "order-production",
        "order-legal",
        "order-it",
        "tech-check",
        "zpr-analysis",
        "committee-protocol",
        "production-tkp",
        "production-contract",
        "production-plan",
    } <= skill_ids
    assert "external-order-calculation-ks" not in skill_ids
    assert "external-order-production-mpp" not in skill_ids
    order_ks = next(item for item in skills if item.id == "order-ks")
    assert order_ks.title == "Заказ"
    assert order_ks.roles == ["ks"]
    assert all(item.source == "builtin" for item in skills)

    written = materialize_skills(tmp_path, ["external-order-case"])
    assert written == ["external-order-case"]
    assert (tmp_path / ".cursor" / "skills" / "external-order-case" / "SKILL.md").is_file()

    case_tool = get_tool("external_order.case")
    assert case_tool is not None
    assert case_tool.execution == "server"
    assert case_tool.timeout_seconds == 180


def test_queue_steer_and_unified_chat_open(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.config.settings.platform_data_dir", tmp_path)
    monkeypatch.setattr("app.config.settings.platform_history_enabled", False)
    store.reset()
    load_tools()
    load_skills()

    client = TestClient(app)

    with (
        patch("app.api.platform.start_turn") as mock_start,
        patch("app.api.platform.wait_idle", side_effect=lambda sid, timeout=15.0: (store.get(sid) is not None and store.get(sid).status != "running")),
        patch("app.api.platform.cancel_turn", return_value=True) as mock_cancel,
    ):
        opened = client.post(
            "/api/v1/platform/chats/open",
            json={
                "workflow_id": "wf-order-1",
                "conversation_key": "eo:ord-1:omto:request",
                "chat_kind": "order",
                "title": "Помощник по закупке",
                "prompt": "Разбор заказа",
                "send_if_empty": True,
            },
        )
        assert opened.status_code == 200
        session = opened.json()
        sid = session["id"]
        assert session["conversation_key"] == "eo:ord-1:omto:request"
        assert mock_start.call_count == 1

        # Simulate active running turn: queueing must NOT return 409
        live = store.get(sid)
        assert live is not None
        live.status = "running"
        live.turns = 1

        queued = client.post(
            f"/api/v1/platform/sessions/{sid}/messages",
            json={"prompt": "Дополнительно проверь НДС", "delivery": "queue"},
        )
        assert queued.status_code == 200
        q_items = queued.json()["queued_messages"]
        assert len(q_items) == 1
        qid = q_items[0]["id"]

        steered = client.post(f"/api/v1/platform/sessions/{sid}/queue/{qid}/steer")
        assert steered.status_code == 200
        assert steered.json()["queued_messages"][0]["steer"] is True
        mock_cancel.assert_called_once_with(sid, keep_queue=True)

        removed = client.delete(f"/api/v1/platform/sessions/{sid}/queue/{qid}")
        assert removed.status_code == 200
        assert removed.json()["queued_messages"] == []

        # Re-opening with send_if_empty=True and turns > 0 must NOT re-send the brief
        reopened = client.post(
            "/api/v1/platform/chats/open",
            json={
                "workflow_id": "wf-order-1",
                "conversation_key": "eo:ord-1:omto:request",
                "chat_kind": "order",
                "title": "Помощник по закупке",
                "prompt": "Разбор заказа",
                "send_if_empty": True,
            },
        )
        assert reopened.status_code == 200
        assert reopened.json()["id"] == sid
        assert mock_start.call_count == 1

    chats = client.get("/api/v1/platform/chats?prefix=eo:ord-1:")
    assert chats.status_code == 200
    assert len(chats.json()["items"]) == 1
