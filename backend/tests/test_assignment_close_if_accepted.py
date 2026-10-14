"""Auto-close of an AST00 assignment once every line is accepted in Docflow."""

from __future__ import annotations

import pytest

from app.services import erp_assignments as ea

REF = "11111111-2222-3333-4444-555555555555"


def _card(status: str, labels: list[str], *, note: str = "") -> dict:
    lines = [
        {"line": index, "text": f"п{index}", "docflow_state": {"label": label}}
        for index, label in enumerate(labels, start=1)
    ]
    item = {"number": "АСТ00-00112", "ref_key": REF, "status": status, "open": ea._status_open(status), "lines": lines}
    card = {"assignment": item}
    if note:
        card["docflow_note"] = note
    return card


def _fake(monkeypatch, cards: list[dict]) -> list[dict]:
    calls: list[dict] = []
    seen: list[dict] = []

    def get(args):
        seen.append(args)
        return cards[min(len(seen) - 1, len(cards) - 1)]

    monkeypatch.setattr(ea, "_get_assignment", get)
    monkeypatch.setattr(ea, "_odata_patch", lambda args: calls.append(args) or {"updated": True})
    return calls


def test_closes_when_every_line_accepted(monkeypatch):
    accepted = ["принято проверяющим", "принято проверяющим"]
    calls = _fake(monkeypatch, [_card("Создано", accepted), _card("Принято", accepted)])

    result = ea.handle_assignments_write(
        {"action": "close_if_accepted", "number": "АСТ00-00112", "session_login": "Иванов", "password": "x"}
    )

    assert result["closed"] is True
    assert calls == [{"entity": ea.ASSIGNMENT_ENTITY, "ref_key": REF, "body": {"Статус": "Принято"}}]


def test_keeps_open_when_a_line_waits(monkeypatch):
    calls = _fake(monkeypatch, [_card("ВРаботе", ["принято проверяющим", "исполнитель отчитался, ждёт проверки"])])

    result = ea.close_if_accepted({"number": "АСТ00-00112"})

    assert result["closed"] is False
    assert result["pending"] == ["п.2: исполнитель отчитался, ждёт проверки"]
    assert calls == []


def test_no_write_without_full_docflow_view(monkeypatch):
    calls = _fake(monkeypatch, [_card("Создано", ["принято проверяющим"], note="ДО недоступен")])

    assert ea.close_if_accepted({"number": "АСТ00-00112"})["closed"] is False
    assert calls == []


def test_already_closed_is_not_patched(monkeypatch):
    calls = _fake(monkeypatch, [_card("Принято", ["принято проверяющим"])])

    result = ea.close_if_accepted({"ref_key": REF})

    assert result["closed"] is True and result["already"] is True
    assert calls == []


@pytest.mark.parametrize("after", ["Создано", ""])
def test_reports_when_status_did_not_change(monkeypatch, after):
    accepted = ["принято проверяющим"]
    _fake(monkeypatch, [_card("Создано", accepted), _card(after, accepted)])

    assert ea.close_if_accepted({"number": "АСТ00-00112"})["closed"] is False
