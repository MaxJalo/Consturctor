"""Производственный календарь РФ для планов работ: пятидневка, праздники и переносы.

Годы из постановлений Правительства записаны явно. Для остальных лет праздники ст. 112 ТК РФ,
выпавшие на выходной, переносятся на ближайший рабочий день. Новые постановления можно положить
в static/ru_work_calendar.json: {"2027": {"holidays": [...], "working_weekends": [...]}}.
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from functools import lru_cache

from app.config import BACKEND_ROOT

DAY_START = time(8, 0)
DAY_FINISH = time(17, 0)

_DECREES: dict[int, dict[str, tuple[str, ...]]] = {
    2026: {
        "holidays": (
            "2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08",
            "2026-01-09", "2026-02-23", "2026-03-09", "2026-05-01", "2026-05-11", "2026-06-12",
            "2026-11-04", "2026-12-31",
        ),
        "working_weekends": (),
    },
}

_FIXED = ((1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8), (2, 23), (3, 8), (5, 1), (5, 9), (6, 12), (11, 4))


@lru_cache(maxsize=1)
def _overrides() -> dict[int, dict[str, tuple[str, ...]]]:
    path = BACKEND_ROOT / "app" / "static" / "ru_work_calendar.json"
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[int, dict[str, tuple[str, ...]]] = {}
    for key, value in (raw.items() if isinstance(raw, dict) else []):
        if str(key).isdigit() and isinstance(value, dict):
            out[int(key)] = {
                "holidays": tuple(str(item) for item in value.get("holidays") or ()),
                "working_weekends": tuple(str(item) for item in value.get("working_weekends") or ()),
            }
    return out


@lru_cache(maxsize=16)
def _year(year: int) -> tuple[frozenset[date], frozenset[date]]:
    known = _overrides().get(year) or _DECREES.get(year)
    if known:
        return (
            frozenset(date.fromisoformat(item) for item in known["holidays"]),
            frozenset(date.fromisoformat(item) for item in known["working_weekends"]),
        )
    days = {date(year, month, day) for month, day in _FIXED}
    for month, day in _FIXED:
        moment = date(year, month, day)
        if month == 1 or moment.weekday() < 5:
            continue
        shifted = moment + timedelta(days=1)
        while shifted.weekday() >= 5 or shifted in days:
            shifted += timedelta(days=1)
        days.add(shifted)
    return frozenset(days), frozenset()


def is_working(day: date) -> bool:
    holidays, working = _year(day.year)
    if day in working:
        return True
    return day.weekday() < 5 and day not in holidays


def next_working(day: date) -> date:
    """Тот же день, если рабочий, иначе ближайший следующий рабочий."""
    while not is_working(day):
        day += timedelta(days=1)
    return day


def after_working(day: date) -> date:
    return next_working(day + timedelta(days=1))


def add_working_days(start: date, days: int) -> date:
    """Последний рабочий день работы длительностью days, начатой в рабочий день start."""
    current = next_working(start)
    for _ in range(max(days, 1) - 1):
        current = after_working(current)
    return current


def working_days_between(first: date, last: date) -> int:
    if last < first:
        return 0
    count = 0
    current = first
    while current <= last:
        if is_working(current):
            count += 1
        current += timedelta(days=1)
    return count


def exceptions(first: date, last: date) -> tuple[list[date], list[date]]:
    """Праздники на буднях и рабочие выходные внутри периода плана."""
    holidays: list[date] = []
    working: list[date] = []
    for year in range(first.year, last.year + 1):
        year_holidays, year_working = _year(year)
        holidays.extend(day for day in year_holidays if first <= day <= last and day.weekday() < 5)
        working.extend(day for day in year_working if first <= day <= last)
    return sorted(holidays), sorted(working)


def at_start(day: date) -> datetime:
    return datetime.combine(day, DAY_START)


def at_finish(day: date) -> datetime:
    return datetime.combine(day, DAY_FINISH)
