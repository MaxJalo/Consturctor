from app.tools.ac.kpi_profile_tool import (
    KPI_READ_METHODOLOGY,
    KpiReadMethodologyTool,
    constructor_database_url,
)


def test_database_url_comes_from_constructor_backend() -> None:
    url = constructor_database_url()
    assert url.startswith("postgresql")
    assert "TurboTest" not in url


def test_tool_returns_methodology_without_module_source(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.tools.ac.kpi_profile_tool._driver_here",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.tools.ac.kpi_profile_tool.read_methodology",
        lambda position, department: {
            "active_count": 1,
            "target_count": 1,
            "metrics": [{"code": "paket", "name": "Пакет"}],
            "modules": [{"metric_code": "paket", "has_source": False}],
        },
    )
    result = KpiReadMethodologyTool().execute(
        {"position": "Помощник Председателя совета директоров", "department": "Управление делами"}
    )
    assert result.ok is True
    assert result.tool_name == KPI_READ_METHODOLOGY
    data = result.output_data or {}
    assert data["metrics"][0]["code"] == "paket"
    assert "source" not in data["modules"][0]
