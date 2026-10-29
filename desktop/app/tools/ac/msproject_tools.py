"""MS Project tools: построение плана .mpp через локальный COM."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.tools.ac.base import BaseTool
from app.tools.ac.registry import ToolRegistry
from app.tools.ac.tooling import (
    ToolCallResult,
    ToolDefinition,
    ToolExecutionMode,
    ToolSideEffectLevel,
)
from app.tools.ac.workers import msproject_com_actions

BUILD_PLAN_TOOL_NAME = "msproject.build_plan"
TEMPLATE_OUTLINE_TOOL_NAME = "msproject.template_outline"
OPEN_FILE_TOOL_NAME = "msproject.open_file"


class MsProjectTool(BaseTool):
    def __init__(self, definition: ToolDefinition, action: Callable[[dict], dict[str, Any]]) -> None:
        super().__init__(definition)
        self._action = action

    def execute(self, input_data: dict) -> ToolCallResult:
        try:
            output = self._action(input_data if isinstance(input_data, dict) else {})
        except Exception as exc:  # noqa: BLE001
            return ToolCallResult(
                ok=False,
                tool_name=self.definition.name,
                error_type="MSPROJECT_FAILED",
                error_message=f"Ошибка MS Project: {exc}",
            )
        if not output.get("ok"):
            return ToolCallResult(
                ok=False,
                tool_name=self.definition.name,
                error_type="MSPROJECT_FAILED",
                error_message=str(output.get("error") or "Ошибка MS Project"),
            )
        return ToolCallResult(ok=True, tool_name=self.definition.name, output_data=output)


def _definition(
    name: str,
    title: str,
    description: str,
    input_schema: dict,
    *,
    side_effect_level: ToolSideEffectLevel = ToolSideEffectLevel.READ,
    timeout_seconds: int = 300,
) -> ToolDefinition:
    return ToolDefinition(
        name=name,
        title=title,
        description=description,
        side_effect_level=side_effect_level,
        execution_mode=ToolExecutionMode.COM_WORKER,
        requires_human_approval=False,
        timeout_seconds=timeout_seconds,
        max_retries=0,
        input_schema=input_schema,
        output_schema={"type": "object"},
        runtime="msproject",
    )


def register_msproject_tools(registry: ToolRegistry, *, skip_existing: bool = False) -> None:
    tools = [
        MsProjectTool(
            _definition(
                BUILD_PLAN_TOOL_NAME,
                "План в MS Project",
                "Собрать .mpp из модели плана: шаблон открывается только на чтение, "
                "результат сохраняется во временную папку и возвращается в base64.",
                {
                    "type": "object",
                    "required": ["model"],
                    "properties": {
                        "model": {"type": "object", "description": "PlanModel от backend"},
                        "template_path": {"type": "string", "description": "Путь к шаблону .mpp/.mpt"},
                        "file_name": {"type": "string", "description": "Имя итогового .mpp"},
                    },
                },
                side_effect_level=ToolSideEffectLevel.CREATE_DRAFT,
                timeout_seconds=600,
            ),
            msproject_com_actions.build_plan,
        ),
        MsProjectTool(
            _definition(
                TEMPLATE_OUTLINE_TOOL_NAME,
                "Структура шаблона MS Project",
                "Прочитать задачи шаблона MS Project без сохранения.",
                {
                    "type": "object",
                    "required": ["template_path"],
                    "properties": {
                        "template_path": {"type": "string", "description": "Путь к шаблону .mpp/.mpt"},
                    },
                },
            ),
            msproject_com_actions.template_outline,
        ),
        MsProjectTool(
            _definition(
                OPEN_FILE_TOOL_NAME,
                "Открыть файл в MS Project",
                "Открыть .mpp в MS Project пользователя по пути или из base64.",
                {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Путь к .mpp"},
                        "content_base64": {"type": "string", "description": "Содержимое .mpp"},
                        "file_name": {"type": "string", "description": "Имя файла для content_base64"},
                    },
                },
                timeout_seconds=60,
            ),
            msproject_com_actions.open_file,
        ),
    ]
    for tool in tools:
        if skip_existing and registry.has_tool(tool.definition.name):
            continue
        registry.register(tool)
