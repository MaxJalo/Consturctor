"""HTTP SOAP inbox документооборота: разбор XML и маппинг без живого /doc."""

from __future__ import annotations

from xml.etree import ElementTree as ET

from app.tools.onec.docflow_inbox_map import map_inbox_row
import pytest

from datetime import date

from app.tools.onec.dok_soap import (
    DokConfig,
    envelope,
    is_today_or_overdue,
    normalize_person,
    object_id_value,
    parse_tasks,
    parse_users,
    performer_value,
    soap_timeout_message,
)


def _soap(inner: str) -> ET.Element:
    return ET.fromstring(envelope(inner))


def test_parse_users_from_dm_list() -> None:
    root = _soap(
        '<dm:return xmlns:dm="http://www.1c.ru/dm" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:type="dm:DMGetObjectListResponse">'
        "<dm:items><dm:object>"
        "<dm:name>Жалыбин Максим Дмитриевич</dm:name>"
        "<dm:objectID><dm:id>user-1</dm:id><dm:type>DMUser</dm:type></dm:objectID>"
        "</dm:object></dm:items>"
        "</dm:return>"
    )
    users = parse_users(root)
    assert users == [
        {"name": "Жалыбин Максим Дмитриевич", "id": "user-1", "type": "DMUser"}
    ]


def test_parse_tasks_and_map_inbox_row() -> None:
    root = _soap(
        '<dm:return xmlns:dm="http://www.1c.ru/dm" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        "<dm:items><dm:object>"
        "<dm:name>Исполнить</dm:name>"
        "<dm:objectID><dm:id>task-9</dm:id><dm:type>DMBusinessProcessTask</dm:type></dm:objectID>"
        "<dm:performer><dm:user><dm:name>Комарькова Анастасия Эдуардовна</dm:name></dm:user></dm:performer>"
        "<dm:author><dm:name>Жалыбин Максим Дмитриевич</dm:name></dm:author>"
        "<dm:beginDate>2026-09-01T10:00:00</dm:beginDate>"
        "<dm:dueDate>2026-09-10T18:00:00</dm:dueDate>"
        "<dm:executed>false</dm:executed>"
        "<dm:businessProcessStep>Исполнение</dm:businessProcessStep>"
        "<dm:number>ДО-17</dm:number>"
        "<dm:description>Подготовить презентацию для клиента</dm:description>"
        "<dm:target><dm:name>Служебная записка</dm:name>"
        "<dm:objectID><dm:id>doc-1</dm:id></dm:objectID></dm:target>"
        "</dm:object></dm:items>"
        "</dm:return>"
    )
    rows = parse_tasks(root)
    assert len(rows) == 1
    assert rows[0]["id"] == "task-9"
    assert rows[0]["performer"] == "Комарькова Анастасия Эдуардовна"
    assert rows[0]["executed"] is False
    mapped = map_inbox_row(rows[0], fio="Комарькова Анастасия Эдуардовна")
    assert mapped["title"] == "Подготовить презентацию для клиента"
    assert mapped["number"] == "ДО-17"
    assert mapped["source"] == "документооборот"
    assert mapped["created_at"].startswith("2026-09-01")
    assert mapped["due_at"].startswith("2026-09-10")
    assert mapped["ref_key"] == "task-9"
    assert mapped["done"] is False


def test_normalize_person_yo_and_spaces() -> None:
    assert normalize_person("Комарькова  Анастасия") == normalize_person("комарькова анастасия")
    assert normalize_person("Ёлкин") == normalize_person("елкин")


def test_is_today_or_overdue() -> None:
    today = date(2026, 9, 16)
    assert is_today_or_overdue(
        {"executed": False, "due": "2026-09-16T18:00:00"}, today=today
    )
    assert is_today_or_overdue(
        {"executed": False, "due": "2026-09-10T10:00:00"}, today=today
    )
    assert not is_today_or_overdue(
        {"executed": False, "due": "2026-09-17T10:00:00"}, today=today
    )
    assert not is_today_or_overdue(
        {"executed": True, "due": "2026-09-10T10:00:00"}, today=today
    )
    assert is_today_or_overdue(
        {"executed": False, "due": "", "begin": "2026-09-16T09:00:00"}, today=today
    )
    assert not is_today_or_overdue(
        {"executed": False, "due": "0001-01-01T00:00:00", "begin": "2026-08-01T09:00:00"},
        today=today,
    )


def test_object_id_value_and_timeout_message() -> None:
    xml = object_id_value("user-1", "DMUser")
    assert 'xsi:type="dm:DMObjectID"' in xml
    assert "<dm:id>user-1</dm:id>" in xml
    assert "<dm:type>DMUser</dm:type>" in xml
    assert soap_timeout_message(45) == "Документооборот SOAP: нет ответа за 45 с"
    executor = performer_value({"id": "user-1", "name": "Иванов И.И.", "type": "DMUser"})
    assert 'xsi:type="dm:DMBusinessProcessTaskExecutor"' in executor
    assert "<dm:id>user-1</dm:id>" in executor
    assert "Иванов И.И." in executor


def test_dok_config_soap_url() -> None:
    config = DokConfig(
        server="192.168.2.229",
        port=81,
        user="svc",
        password="x",
        timeout=30,
        base_path="/doc",
    )
    assert config.soap_url() == "http://192.168.2.229:81/doc/ws/dm.1cws"
    assert config.auth_header().startswith("Basic ")


def test_filter_ignored_needs_several_other_performers() -> None:
    from app.tools.onec.dok_soap import _filter_ignored

    assert _filter_ignored([], "Иванов И.И.") is False
    assert _filter_ignored([{"performer": "Иванов И.И."}], "Иванов И.И.") is False
    assert (
        _filter_ignored(
            [
                {"performer": "А"},
                {"performer": "Б"},
                {"performer": "В"},
                {"performer": "Иванов И.И."},
            ],
            "Иванов И.И.",
        )
        is True
    )


def test_fetch_inbox_does_not_dump_all_tasks(monkeypatch) -> None:
    from app.tools.onec import dok_soap

    modes: list[str | None] = []
    monkeypatch.setattr(
        dok_soap,
        "find_user",
        lambda *_args, **_kwargs: {"id": "1", "name": "Иванов И.И.", "type": "DMUser"},
    )

    def fake_list(*_args, **kwargs):
        modes.append(kwargs.get("filter_mode"))
        raise RuntimeError("Неизвестное поле в условии отбора: byUser")

    monkeypatch.setattr(dok_soap, "list_open_tasks", fake_list)
    config = DokConfig(
        server="192.168.2.229",
        port=81,
        user="svc",
        password="x",
        timeout=30,
        base_path="/doc",
    )
    with pytest.raises(RuntimeError, match="Неизвестное поле"):
        dok_soap.fetch_inbox(config, "Иванов И.И.", since_days=30, retrieve=False)
    assert modes == ["byUser", "performer"]


def test_fetch_inbox_keeps_dump_when_server_ignores_filter(monkeypatch) -> None:
    from app.tools.onec import dok_soap

    calls = {"n": 0}
    monkeypatch.setattr(
        dok_soap,
        "find_user",
        lambda *_args, **_kwargs: {"id": "1", "name": "Иванов И.И.", "type": "DMUser"},
    )

    def fake_list(*_args, **kwargs):
        calls["n"] += 1
        assert kwargs.get("filter_mode") == "byUser"
        return [
            {"id": "a", "performer": "А", "executed": False, "due": "2026-09-16T18:00:00"},
            {"id": "b", "performer": "Б", "executed": False, "due": "2026-09-16T18:00:00"},
            {"id": "c", "performer": "В", "executed": False, "due": "2026-09-16T18:00:00"},
            {
                "id": "mine",
                "performer": "Иванов И.И.",
                "executed": False,
                "due": "2026-09-16T18:00:00",
            },
        ]

    monkeypatch.setattr(dok_soap, "list_open_tasks", fake_list)
    config = DokConfig(
        server="192.168.2.229",
        port=81,
        user="svc",
        password="x",
        timeout=30,
        base_path="/doc",
    )
    payload = dok_soap.fetch_inbox(
        config,
        "Иванов И.И.",
        since_days=30,
        retrieve=False,
        today_and_overdue=True,
    )
    assert calls["n"] == 1
    assert payload["count"] == 1
    assert payload["rows"][0]["id"] == "mine"


def test_inbox_cache_shares_dump_across_users(tmp_path, monkeypatch) -> None:
    from app.tools.onec import dok_soap

    dok_soap._inbox_cache.clear()
    dok_soap._refreshing.clear()
    monkeypatch.setattr(dok_soap, "_cache_dir", lambda: tmp_path)
    monkeypatch.setattr(
        dok_soap,
        "load_config",
        lambda **_kwargs: DokConfig(
            server="192.168.2.229",
            port=81,
            user="svc",
            password="x",
            timeout=210,
            base_path="/doc",
        ),
    )
    calls = {"n": 0}

    def fake_dump(*_args, **_kwargs):
        calls["n"] += 1
        return {
            "endpoint": "http://192.168.2.229:81/doc/ws/dm.1cws",
            "only_open": True,
            "count": 3,
            "rows": [
                {
                    "id": "1",
                    "performer": "Иванов И.И.",
                    "executed": False,
                    "due": "2026-09-16T18:00:00",
                },
                {
                    "id": "2",
                    "performer": "Петров П.П.",
                    "executed": False,
                    "due": "2026-09-10T18:00:00",
                },
                {
                    "id": "3",
                    "performer": "Сидоров С.С.",
                    "executed": False,
                    "due": "2026-09-20T18:00:00",
                },
            ],
        }

    monkeypatch.setattr(dok_soap, "fetch_open_dump", fake_dump)
    first = dok_soap.fetch_user_inbox_tasks("Иванов И.И.", today_and_overdue=True)
    second = dok_soap.fetch_user_inbox_tasks("Петров П.П.", today_and_overdue=True)
    assert calls["n"] == 1
    assert first["cached"] is False
    assert first["count"] == 1
    assert first["rows"][0]["id"] == "1"
    assert first["dump_count"] == 3
    assert second["cached"] is True
    assert second["count"] == 1
    assert second["rows"][0]["id"] == "2"
    third = dok_soap.fetch_user_inbox_tasks(
        "Иванов И.И.", today_and_overdue=True, force_refresh=True
    )
    assert calls["n"] == 2
    assert third["cached"] is False
