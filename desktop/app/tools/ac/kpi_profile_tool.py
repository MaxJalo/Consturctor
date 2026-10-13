"""Чтение методики KPI из базы Constructor. Агент не пишет для этого свой SQL."""

from __future__ import annotations

import json
import os
import subprocess
from typing import Any
from urllib.parse import unquote, urlparse

from app.config import REPO_ROOT
from app.tools.ac.base import BaseTool
from app.tools.ac.registry import ToolRegistry
from app.tools.ac.tooling import (
    ToolCallResult,
    ToolDefinition,
    ToolExecutionMode,
    ToolSideEffectLevel,
)

KPI_READ_METHODOLOGY = "kpi.read_methodology"

_DELEGATE = (
    "import json, sys\n"
    "from app.tools.ac.kpi_profile_tool import read_methodology\n"
    "raw = json.loads(sys.stdin.read() or '{}')\n"
    "json.dump(read_methodology(raw.get('position') or '', raw.get('department') or ''), "
    "sys.stdout, ensure_ascii=False)\n"
)


class KpiProfileError(Exception):
    pass


def constructor_database_url() -> str:
    """Адрес базы Constructor из его backend/.env. TurboTest не читаем."""
    env_path = REPO_ROOT / "backend" / ".env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            text = line.strip()
            if not text or text.startswith("#") or "=" not in text:
                continue
            key, value = text.split("=", 1)
            if key.strip() == "DATABASE_URL":
                url = value.strip().strip('"').strip("'")
                if url:
                    return url
    raise KpiProfileError("DATABASE_URL не найден в backend/.env Constructor")


def _connect(url: str):
    clean = url.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgresql+psycopg://", "postgresql://"
    )
    parsed = urlparse(clean)
    kwargs = {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "dbname": parsed.path.lstrip("/"),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
    }
    try:
        import psycopg2
    except ImportError:
        import psycopg
        return psycopg.connect(**kwargs)
    return psycopg2.connect(**kwargs)


def _plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (dict, list)):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _rows(cursor) -> list[dict[str, Any]]:
    columns = [item[0] for item in cursor.description]
    records = []
    for row in cursor.fetchall():
        records.append({key: _plain(value) for key, value in zip(columns, row)})
    return records


def read_methodology(position: str = "", department: str = "") -> dict[str, Any]:
    """Активные методики. С должностью — показатели, источники, премия и наличие модулей."""
    position = (position or "").strip()
    department = (department or "").strip()
    conn = _connect(constructor_database_url())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, position_name, department, status, source_import_id,
                   effective_from, effective_to, source_title, summary
            FROM position_kpi_profiles
            WHERE status = 'active'
              AND source_import_id IS NOT NULL
              AND TRIM(source_import_id) <> ''
            ORDER BY position_name, department
            """
        )
        profiles = _rows(cur)
        target = [
            item
            for item in profiles
            if (not position or item.get("position_name") == position)
            and (not department or item.get("department") == department)
        ]
        result: dict[str, Any] = {
            "active_count": len(profiles),
            "profiles": [
                {
                    "id": item.get("id"),
                    "position_name": item.get("position_name"),
                    "department": item.get("department"),
                    "effective_from": item.get("effective_from"),
                    "effective_to": item.get("effective_to"),
                }
                for item in profiles
            ],
        }
        if not position and not department:
            return result
        result["target_count"] = len(target)
        result["target"] = target
        if len(target) != 1:
            return result
        profile_id = target[0]["id"]
        cur.execute(
            """
            SELECT id, profile_id, code, name, sort_order, weight, unit,
                   plan_value, direction, formula_kind, formula_json, formula_human
            FROM position_kpi_metrics
            WHERE profile_id = %s
            ORDER BY sort_order, code
            """,
            (profile_id,),
        )
        metrics = _rows(cur)
        result["metrics"] = metrics
        metric_ids = [item["id"] for item in metrics]
        sources: list[dict[str, Any]] = []
        if metric_ids:
            cur.execute(
                """
                SELECT id, metric_id, role, kind, title, detail, update_rule
                FROM position_kpi_sources
                WHERE metric_id = ANY(%s)
                ORDER BY metric_id, role
                """,
                (metric_ids,),
            )
            sources = _rows(cur)
        result["sources"] = sources
        cur.execute(
            """
            SELECT profile_id, bonus_kind, bonus_base_pct, bonus_human
            FROM position_comp_rules
            WHERE profile_id = %s
            """,
            (profile_id,),
        )
        result["comp_rules"] = _rows(cur)
        cur.execute(
            """
            SELECT profile_id, metric_code, module_name,
                   CASE WHEN source IS NULL OR TRIM(source) = '' THEN false ELSE true END AS has_source,
                   length(coalesce(source, '')) AS source_len,
                   content_hash
            FROM position_kpi_modules
            WHERE profile_id = %s
            ORDER BY metric_code
            """,
            (profile_id,),
        )
        result["modules"] = _rows(cur)
        return result
    finally:
        conn.close()


class KpiReadMethodologyTool(BaseTool):
    def __init__(self) -> None:
        super().__init__(
            ToolDefinition(
                name=KPI_READ_METHODOLOGY,
                title="Методика KPI",
                description=(
                    "Читает методики KPI из базы Constructor. Без аргументов возвращает "
                    "список активных должностей. С position и department — показатели, "
                    "источники плана и факта, правило премии и наличие модулей "
                    "(текст модуля не отдаёт). SQL и .env писать не нужно."
                ),
                side_effect_level=ToolSideEffectLevel.READ,
                execution_mode=ToolExecutionMode.LOCAL,
                requires_human_approval=False,
                timeout_seconds=60,
                max_retries=0,
                input_schema={
                    "type": "object",
                    "properties": {
                        "position": {
                            "type": "string",
                            "description": "Точное название должности. Пусто — только список профилей.",
                        },
                        "department": {
                            "type": "string",
                            "description": "Подразделение, если должность одна и та же в нескольких местах.",
                        },
                    },
                },
                output_schema={"type": "object"},
            )
        )

    def execute(self, input_data: dict) -> ToolCallResult:
        raw = input_data if isinstance(input_data, dict) else {}
        position = str(raw.get("position") or "")
        department = str(raw.get("department") or "")
        try:
            if _driver_here():
                payload = read_methodology(position, department)
            else:
                payload = _via_project_python(position, department)
        except KpiProfileError as exc:
            return ToolCallResult(
                ok=False,
                tool_name=self.definition.name,
                error_type="KPI_PROFILE_ERROR",
                error_message=str(exc),
            )
        except Exception as exc:
            return ToolCallResult(
                ok=False,
                tool_name=self.definition.name,
                error_type="KPI_PROFILE_ERROR",
                error_message=f"Не удалось прочитать методику: {exc}",
            )
        return ToolCallResult(
            ok=True,
            tool_name=self.definition.name,
            output_data=payload,
        )


def _driver_here() -> bool:
    try:
        import psycopg2  # noqa: F401
        return True
    except ImportError:
        pass
    try:
        import psycopg  # noqa: F401
        return True
    except ImportError:
        return False


def _via_project_python(position: str, department: str) -> dict[str, Any]:
    from app.config import DESKTOP_ROOT
    from app.tools.ac.code_execution_tools import script_command_prefix

    command = [*script_command_prefix(), "-c", _DELEGATE]
    env = dict(os.environ)
    env["PYTHONPATH"] = str(DESKTOP_ROOT)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env.pop("PYTHONSAFEPATH", None)
    try:
        completed = subprocess.run(
            command,
            input=json.dumps({"position": position, "department": department}, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise KpiProfileError(f"Интерпретатор с драйвером Postgres не запустил чтение: {exc}") from exc
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip()[-500:]
        raise KpiProfileError(tail or "Чтение методики завершилось с ошибкой")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise KpiProfileError("Чтение методики вернуло не JSON") from exc
    if not isinstance(payload, dict):
        raise KpiProfileError("Чтение методики вернуло не объект")
    return payload


def register_kpi_profile_tool(registry: ToolRegistry, *, skip_existing: bool = False) -> None:
    tool = KpiReadMethodologyTool()
    if skip_existing and registry.has_tool(tool.definition.name):
        return
    registry.register(tool)
