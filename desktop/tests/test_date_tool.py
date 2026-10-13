from __future__ import annotations

from zoneinfo import ZoneInfoNotFoundError

from app.tools.ac.date_tool import GetCurrentDateTool


def test_current_date_defaults_to_moscow() -> None:
    result = GetCurrentDateTool().execute({})
    assert result.ok is True
    data = result.output_data or {}
    assert data["timezone"] == "Europe/Moscow"
    assert len(data["date_iso"]) == 10
    assert data["weekday_ru"]
    assert data["date_ru"].endswith(data["date_iso"][:4])
    assert data["datetime_iso"].startswith(data["date_iso"])


def test_current_date_accepts_utc() -> None:
    result = GetCurrentDateTool().execute({"timezone": "UTC"})
    assert result.ok is True
    assert (result.output_data or {})["timezone"] == "UTC"


def test_moscow_works_when_zoneinfo_database_is_missing(monkeypatch) -> None:
    def missing(_name: str):
        raise ZoneInfoNotFoundError(_name)

    monkeypatch.setattr("app.tools.ac.date_tool.ZoneInfo", missing)
    empty = GetCurrentDateTool().execute({})
    named = GetCurrentDateTool().execute({"timezone": "Europe/Moscow"})
    assert empty.ok is True
    assert named.ok is True
    for result in (empty, named):
        data = result.output_data or {}
        assert data["timezone"] == "Europe/Moscow"
        assert data["datetime_iso"].endswith("+03:00")


def test_current_date_rejects_unknown_timezone() -> None:
    result = GetCurrentDateTool().execute({"timezone": "Not/AZone"})
    assert result.ok is False
    assert result.error_type == "UNKNOWN_TIMEZONE"
