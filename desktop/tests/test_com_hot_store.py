"""Пустой ответ COM не стирает последний снимок пользователя."""

from __future__ import annotations

from app.tools.ac.workers.com_hot_store import mail_query_key, retain_list


def test_empty_reread_keeps_the_previous_list(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("CONSTRUCTOR_COM_HOT", str(tmp_path))
    key = mail_query_key({"folder": "Inbox", "date": "2026-11-11"})
    first = retain_list("mail", key, {"messages": [{"subject": "Договор"}], "count": 1}, "messages")
    assert first["messages"][0]["subject"] == "Договор"

    again = retain_list("mail", key, {"messages": [], "count": 0}, "messages")
    assert again["kept"] is True
    assert again["messages"][0]["subject"] == "Договор"


def test_another_query_does_not_reuse_the_snapshot(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("CONSTRUCTOR_COM_HOT", str(tmp_path))
    retain_list(
        "mail",
        mail_query_key({"folder": "Inbox", "date": "2026-11-11"}),
        {"messages": [{"subject": "Договор"}]},
        "messages",
    )
    other = retain_list(
        "mail",
        mail_query_key({"folder": "Inbox", "date": "2026-11-12"}),
        {"messages": [], "count": 0},
        "messages",
    )
    assert other["messages"] == []
    assert "kept" not in other


def test_a_real_update_replaces_the_snapshot(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("CONSTRUCTOR_COM_HOT", str(tmp_path))
    key = mail_query_key({"folder": "Inbox"})
    retain_list("mail", key, {"messages": [{"subject": "Старое"}]}, "messages")
    updated = retain_list("mail", key, {"messages": [{"subject": "Новое"}]}, "messages")
    assert updated["messages"][0]["subject"] == "Новое"
    assert "kept" not in updated
