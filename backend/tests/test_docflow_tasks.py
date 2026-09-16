"""OData документооборота: URL, маппинг задач, без живого /doc."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from app.services.docflow_document_tasks import (
    fio_matches,
    map_document_executor_row,
    odata_executor_filter_clauses,
)
from app.services.docflow_tasks import (
    _credentials_from_args,
    _map_task,
    _parse_odata_dt,
    docflow_auth,
    docflow_base_url,
    docflow_env_auth,
    odata_entity,
)


def test_docflow_auth_prefers_session_fio_password(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.docflow_tasks.settings",
        SimpleNamespace(
            docflow_odata_username="env-user",
            docflow_odata_password="env-pass",
            odata_username="odata-only",
            odata_password="odata-pass",
            erp_login="",
            erp_password="",
        ),
    )
    assert docflow_env_auth() == ("env-user", "env-pass")
    assert docflow_auth({"fio": "Иванов И.И.", "password": "secret"}) == (
        "Иванов И.И.",
        "secret",
    )
    assert docflow_auth(
        {"username": "name_mail_slug", "fio": "Иванов И.И.", "password": "secret"}
    ) == ("Иванов И.И.", "secret")
    assert _credentials_from_args({"username": "u", "erp_password": "p"}) == ("u", "p")


def test_docflow_env_auth_falls_back_to_odata_when_no_docflow_or_erp(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.docflow_tasks.settings",
        SimpleNamespace(
            docflow_odata_username="",
            docflow_odata_password="",
            odata_username="odata-only",
            odata_password="odata-pass",
            erp_login="",
            erp_password="",
        ),
    )
    assert docflow_env_auth() == ("odata-only", "odata-pass")


def test_docflow_base_url_from_erp(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.docflow_tasks.settings",
        SimpleNamespace(docflow_odata_base_url="", odata_base_url="http://host/erp_pm/odata/standard.odata"),
    )
    assert docflow_base_url() == "http://host/doc/odata/standard.odata"


def test_docflow_base_url_explicit(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.docflow_tasks.settings",
        SimpleNamespace(
            docflow_odata_base_url="http://host/doc/odata/standard.odata/",
            odata_base_url="http://host/erp_pm/odata/standard.odata",
        ),
    )
    assert docflow_base_url() == "http://host/doc/odata/standard.odata"


def test_parse_odata_dt_skips_empty() -> None:
    assert _parse_odata_dt("") is None
    assert _parse_odata_dt("0001-01-01T00:00:00") is None
    parsed = _parse_odata_dt("2026-08-17T12:00:00")
    assert parsed == datetime(2026, 8, 17, 12, 0, 0)


def test_odata_entity_and_executor_filters() -> None:
    assert odata_entity() == "Task_ЗадачаИсполнителя"
    clauses = odata_executor_filter_clauses("41290a43-1111-2222-3333-444455556666")
    assert len(clauses) == 2
    assert "Исполнитель_Key eq guid'" in clauses[0][0]


def test_fio_matches_executor_column() -> None:
    assert fio_matches("Жалыбин Максим Дмитриевич", "Жалыбин Максим Дмитриевич")
    assert fio_matches("  жалыбин   максим  ", "Жалыбин Максим")


def test_map_document_executor_row_subject_and_action() -> None:
    row = {
        "Number": "DO-12",
        "Description": "Исполнить",
        "ПредметСтрокой": "Заявка в службу развития…",
        "Executed": False,
        "СрокИсполнения": "2025-09-15T00:00:00",
        "Исполнитель_Name": "Жалыбин Максим Дмитриевич",
    }
    item = map_document_executor_row(row, fio="Жалыбин Максим Дмитриевич")
    assert "Заявка в службу развития" in item["title"]
    assert "Исполнить" in item["title"]
    assert item["due_at"].startswith("2025-09-15")
    assert item["performer"] == "Жалыбин Максим Дмитриевич"


def test_list_docflow_tasks_uses_soap_not_odata(monkeypatch) -> None:
    from app.services import docflow_tasks

    called = {"odata": 0}

    def _forbidden_get(*_args, **_kwargs):
        called["odata"] += 1
        raise AssertionError("OData не должен вызываться для задач ДО")

    monkeypatch.setattr(docflow_tasks, "_get", _forbidden_get)
    monkeypatch.setattr(
        "app.tools.onec.docflow_inbox_fetch.fetch_inbox_tasks_soap",
        lambda fio, **_kwargs: (
            [
                {
                    "number": "do-1",
                    "title": "Согласовать",
                    "source": "документооборот",
                    "done": False,
                    "created_at": "2026-09-01 10:00:00",
                    "due_at": "2026-09-10 18:00:00",
                    "performer": fio,
                }
            ],
            "",
        ),
    )
    rows = docflow_tasks.list_docflow_tasks(
        fio="Иванов И.И.",
        only_open=True,
        limit=20,
        today_and_overdue=True,
    )
    assert called["odata"] == 0
    assert len(rows) == 1
    assert rows[0]["title"] == "Согласовать"


def test_list_docflow_today_and_overdue_drops_future(monkeypatch) -> None:
    from app.services import docflow_tasks

    monkeypatch.setattr(docflow_tasks, "_get", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        "app.tools.onec.docflow_inbox_fetch.fetch_inbox_tasks_soap",
        lambda fio, **_kwargs: (
            [
                {
                    "number": "late",
                    "title": "Просрочена",
                    "done": False,
                    "due_at": "2026-09-10 18:00:00",
                    "created_at": "2026-09-01 10:00:00",
                },
                {
                    "number": "future",
                    "title": "Потом",
                    "done": False,
                    "due_at": "2026-12-01 18:00:00",
                    "created_at": "2026-09-01 10:00:00",
                },
            ],
            "",
        ),
    )
    rows = docflow_tasks.list_docflow_tasks(
        fio="Иванов И.И.",
        only_open=True,
        today_and_overdue=True,
        limit=20,
    )
    assert [row["title"] for row in rows] == ["Просрочена"]


def test_list_docflow_for_people_does_not_require_odata(monkeypatch) -> None:
    from app.services import docflow_tasks

    monkeypatch.setattr(docflow_tasks, "docflow_base_url", lambda: "")
    monkeypatch.setattr(
        docflow_tasks,
        "list_docflow_tasks",
        lambda **kwargs: [{"number": "1", "title": kwargs["fio"], "source": "документооборот"}],
    )
    extra, warning = docflow_tasks.list_docflow_for_people(["Петров П.П."], only_open=True)
    assert warning == ""
    assert extra["Петров П.П."][0]["title"] == "Петров П.П."


def test_map_task_marks_source_and_late() -> None:
    row = {
        "Number": "38",
        "Description": "Исполнить задачу №2",
        "Executed": False,
        "Date": "2026-08-10T09:00:00",
        "СрокИсполнения": "2026-08-12T18:00:00",
        "ДатаИсполнения": "",
        "Описание": "протокол",
        "СостояниеБизнесПроцесса": "",
    }
    item = _map_task(row, fio="Мангасарян Давид Каренович")
    assert item["source"] == "документооборот"
    assert item["done"] is False
    assert item["late"] is False
    assert item["title"] == "Исполнить задачу №2"
    assert item["performer"] == "Мангасарян Давид Каренович"

    done = dict(row)
    done["Executed"] = True
    done["ДатаИсполнения"] = "2026-08-13T10:00:00"
    late = _map_task(done, fio="X")
    assert late["done"] is True
    assert late["late"] is True
