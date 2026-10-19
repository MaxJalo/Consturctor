"""Текущая дата для агента. Тот же контракт, что get_current_date в TurboTest."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.tools.ac.base import BaseTool
from app.tools.ac.registry import ToolRegistry
from app.tools.ac.tooling import (
    ToolCallResult,
    ToolDefinition,
    ToolExecutionMode,
    ToolSideEffectLevel,
)

DATE_TOOL_NAME = "get_current_date"
DEFAULT_TIMEZONE = "Europe/Moscow"
# Москва без перехода на летнее время с 2014 года. Нужен, когда в Python нет tzdata:
# тогда ZoneInfo("Europe/Moscow") и даже ZoneInfo("UTC") не находятся.
_FIXED_OFFSETS = {
    "europe/moscow": timedelta(hours=3),
    "moscow": timedelta(hours=3),
    "msk": timedelta(hours=3),
    "utc": timedelta(0),
    "etc/utc": timedelta(0),
    "gmt": timedelta(0),
}

WEEKDAY_RU = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)
MONTH_RU = (
    "",
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)


class GetCurrentDateTool(BaseTool):
    """Возвращает сегодняшнюю дату, день недели и время."""

    def __init__(self) -> None:
        super().__init__(
            ToolDefinition(
                name=DATE_TOOL_NAME,
                title="Текущая дата",
                description=(
                    "Возвращает текущую дату, день недели и время в указанном часовом поясе. "
                    "По умолчанию Europe/Moscow. Вызывай, когда нужна дата среза, «сегодня» "
                    "или текущий день, и не подменяй это чтением журнала прошлого запуска."
                ),
                side_effect_level=ToolSideEffectLevel.READ,
                execution_mode=ToolExecutionMode.LOCAL,
                requires_human_approval=False,
                timeout_seconds=15,
                max_retries=0,
                input_schema={
                    "type": "object",
                    "properties": {
                        "timezone": {
                            "type": "string",
                            "description": "IANA timezone, например Europe/Moscow или UTC",
                        }
                    },
                },
                output_schema={
                    "type": "object",
                    "properties": {
                        "date_iso": {"type": "string"},
                        "date_ru": {"type": "string"},
                        "weekday_ru": {"type": "string"},
                        "timezone": {"type": "string"},
                        "datetime_iso": {"type": "string"},
                    },
                },
            )
        )

    def execute(self, input_data: dict) -> ToolCallResult:
        raw = input_data if isinstance(input_data, dict) else {}
        timezone_name = str(raw.get("timezone") or raw.get("tz") or DEFAULT_TIMEZONE).strip()
        timezone_name = timezone_name or DEFAULT_TIMEZONE
        try:
            tz = _zone(timezone_name)
        except ZoneInfoNotFoundError:
            return ToolCallResult(
                ok=False,
                tool_name=self.definition.name,
                error_type="UNKNOWN_TIMEZONE",
                error_message=f"Неизвестный timezone: {timezone_name}",
            )
        now = datetime.now(tz)
        return ToolCallResult(
            ok=True,
            tool_name=self.definition.name,
            output_data={
                "date_iso": now.date().isoformat(),
                "date_ru": f"{now.day} {MONTH_RU[now.month]} {now.year}",
                "weekday_ru": WEEKDAY_RU[now.weekday()],
                "timezone": timezone_name,
                "datetime_iso": now.isoformat(),
            },
        )


def _zone(name: str):
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        offset = _FIXED_OFFSETS.get(name.casefold())
        if offset is None:
            raise
        return timezone(offset)


def register_date_tool(registry: ToolRegistry, *, skip_existing: bool = False) -> None:
    tool = GetCurrentDateTool()
    if skip_existing and registry.has_tool(tool.definition.name):
        return
    registry.register(tool)
