"""MS Project COM worker на фейковом MSProject.Application (без реального Project)."""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.tools.ac.msproject_tools import register_msproject_tools
from app.tools.ac.registry import ToolRegistry
from app.tools.ac.workers import msproject_com_actions as mod


class FakeDependencies:
    def __init__(self, task: "FakeTask") -> None:
        self._task = task

    def Add(self, pred: "FakeTask", kind: int) -> None:  # noqa: N802
        self._task.links.append((pred, kind))


class FakeTask:
    def __init__(self, tasks: "FakeTasks", name: str, task_id: int) -> None:
        self._tasks = tasks
        self.Name = name
        self.ID = task_id
        self.OutlineLevel = 1
        self.Duration = 480
        self.Milestone = False
        self.Summary = False
        self.Notes = ""
        self.ConstraintType = 0
        self.ConstraintDate = None
        self.ResourceNames = ""
        self.Predecessors = ""
        self.links: list[tuple[FakeTask, int]] = []
        self.TaskDependencies = FakeDependencies(self)
        self.PredecessorTasks: list[FakeTask] = []

    def Delete(self) -> None:  # noqa: N802
        self._tasks.items.remove(self)


class FakeTasks:
    def __init__(self, fail_add: bool = False) -> None:
        self.items: list[FakeTask | None] = []
        self.fail_add = fail_add

    @property
    def Count(self) -> int:  # noqa: N802
        return len(self.items)

    def Item(self, index: int) -> FakeTask | None:  # noqa: N802
        return self.items[index - 1]

    def Add(self, name: str) -> FakeTask:  # noqa: N802
        if self.fail_add:
            raise RuntimeError("COM сломался")
        task = FakeTask(self, name, len(self.items) + 1)
        self.items.append(task)
        return task


class FakeResource:
    def __init__(self, name: str) -> None:
        self.Name = name


class FakeResources:
    def __init__(self) -> None:
        self.items: list[FakeResource] = []

    @property
    def Count(self) -> int:  # noqa: N802
        return len(self.items)

    def Item(self, index: int) -> FakeResource:  # noqa: N802
        return self.items[index - 1]

    def Add(self, name: str) -> FakeResource:  # noqa: N802
        item = FakeResource(name)
        self.items.append(item)
        return item


class FakePeriod:
    def __init__(self, calendar: "FakeCalendar", day: datetime) -> None:
        self._calendar = calendar
        self._day = day

    @property
    def Working(self) -> bool:  # noqa: N802
        return self._calendar.marks.get(self._day.date(), True)

    @Working.setter
    def Working(self, value: bool) -> None:  # noqa: N802
        self._calendar.marks[self._day.date()] = value


class FakeCalendar:
    def __init__(self) -> None:
        self.marks: dict = {}

    def Period(self, day: datetime) -> FakePeriod:  # noqa: N802
        return FakePeriod(self, day)


class FakeSummary:
    Name = ""


class FakeProject:
    def __init__(self, path: str = "", fail_add: bool = False) -> None:
        self.path = path
        self.Tasks = FakeTasks(fail_add)
        self.Resources = FakeResources()
        self.Calendar = FakeCalendar()
        self.ProjectSummaryTask = FakeSummary()
        self.ProjectStart = None


class FakeApp:
    def __init__(self, template_tasks: int = 0, fail_add: bool = False) -> None:
        self.Visible = True
        self.DisplayAlerts = True
        self.calls: list[tuple] = []
        self.ActiveProject: FakeProject | None = None
        self._template_tasks = template_tasks
        self._fail_add = fail_add

    def FileOpenEx(self, path: str, read_only: bool) -> None:  # noqa: N802
        self.calls.append(("FileOpenEx", path, read_only))
        project = FakeProject(path, self._fail_add)
        project.Tasks.fail_add = False
        for index in range(self._template_tasks):
            project.Tasks.Add(f"Шаблонная задача {index + 1}")
        project.Tasks.items.insert(1, None)
        project.Resources.Add("Иванов")
        project.Tasks.fail_add = self._fail_add
        self.ActiveProject = project

    def FileNew(self) -> None:  # noqa: N802
        self.calls.append(("FileNew",))
        self.ActiveProject = FakeProject("", self._fail_add)

    def FileSaveAs(self, path: str) -> None:  # noqa: N802
        self.calls.append(("FileSaveAs", path))
        self.ActiveProject.path = path
        Path(path).write_bytes(b"MPP-SAVED-AS")

    def FileSave(self) -> None:  # noqa: N802
        self.calls.append(("FileSave", self.ActiveProject.path))
        Path(self.ActiveProject.path).write_bytes(b"MPP-FILLED")

    def FileCloseEx(self, save: int) -> None:  # noqa: N802
        self.calls.append(("FileCloseEx", save))

    def Quit(self, save: int) -> None:  # noqa: N802
        self.calls.append(("Quit", save))

    def names(self) -> list[str]:
        return [call[0] for call in self.calls]


class FakeClient:
    def __init__(self, app: FakeApp, running: bool) -> None:
        self.app = app
        self.running = running

    def GetActiveObject(self, progid: str) -> FakeApp:  # noqa: N802
        assert progid == "MSProject.Application"
        if not self.running:
            raise OSError("Операция недоступна")
        return self.app

    def Dispatch(self, progid: str) -> FakeApp:  # noqa: N802
        assert progid == "MSProject.Application"
        return self.app


class FakePythoncom:
    def __init__(self) -> None:
        self.init = 0
        self.uninit = 0

    def CoInitialize(self) -> None:  # noqa: N802
        self.init += 1

    def CoUninitialize(self) -> None:  # noqa: N802
        self.uninit += 1


@pytest.fixture
def com(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    temp_root = tmp_path / "temp"
    temp_root.mkdir()
    monkeypatch.setenv("TEMP", str(temp_root))
    monkeypatch.setattr(mod, "msproject_com_availability", lambda: (True, "MS Project COM доступен"))
    monkeypatch.setattr(mod, "_winproj_pids", lambda: set())
    state: dict = {"pythoncom": FakePythoncom()}

    def install(app: FakeApp, *, running: bool = False) -> FakeApp:
        client = FakeClient(app, running)
        monkeypatch.setattr(mod, "_com_modules", lambda: (state["pythoncom"], client))
        return app

    state["install"] = install
    state["temp"] = temp_root / mod.TEMP_SUBDIR
    return state


@pytest.fixture
def template(tmp_path: Path) -> Path:
    shared = tmp_path / "shared"
    shared.mkdir()
    path = shared / "Шаблон.mpp"
    path.write_bytes(b"TEMPLATE")
    return path


def _model() -> dict:
    return {
        "code": "P-1",
        "title": "Проект реконструкции",
        "start": "2026-11-02",
        "finish": "2026-12-01",
        "calendar": {"holidays": ["2026-11-04"], "working_weekends": ["2026-11-07"]},
        "resources": [{"key": "pm", "name": "Петров П.П."}, {"key": "eng", "name": "Иванов"}],
        "tasks": [
            {"uid": 1, "key": "root", "wbs": "0", "name": "Проект реконструкции", "level": 0,
             "summary": True, "milestone": False, "duration_days": 0, "start": "2026-11-02T08:00:00",
             "predecessors": [], "resource": "", "resource_name": "", "group": "root", "notes": ""},
            {"uid": 2, "key": "work", "wbs": "1", "name": "Работы", "level": 1, "summary": True,
             "milestone": False, "duration_days": 10, "start": "2026-11-02T08:00:00",
             "predecessors": [1], "resource": "", "resource_name": "", "group": "work", "notes": ""},
            {"uid": 3, "key": "design", "wbs": "1.1", "name": "Проектирование", "level": 2,
             "summary": False, "milestone": False, "duration_days": 2, "start": "2026-11-05T08:00:00",
             "predecessors": [], "resource": "pm", "resource_name": "", "group": "work",
             "notes": "Согласовать с заказчиком"},
            {"uid": 4, "key": "build", "wbs": "1.2", "name": "Монтаж", "level": 2, "summary": False,
             "milestone": False, "duration_days": 1.5, "start": "2026-11-09T08:00:00",
             "predecessors": [3], "resource": "eng", "resource_name": "Иванов", "group": "work",
             "notes": ""},
            {"uid": 5, "key": "done", "wbs": "1.3", "name": "Сдача", "level": 2, "summary": False,
             "milestone": True, "duration_days": 0, "start": "2026-11-11T08:00:00",
             "predecessors": [4, 4], "resource": "", "resource_name": "", "group": "work", "notes": ""},
            {"uid": 6, "key": "cond", "wbs": "2", "name": "Условия", "level": 1, "summary": False,
             "milestone": False, "duration_days": 3, "start": "2026-11-02T08:00:00",
             "predecessors": [], "resource": "", "resource_name": "", "group": "conditions",
             "notes": ""},
        ],
    }


def _by_name(app: FakeApp) -> dict[str, FakeTask]:
    return {task.Name: task for task in app.ActiveProject.Tasks.items if task is not None}


def test_build_plan_from_template_never_touches_template(com, template: Path) -> None:
    app = com["install"](FakeApp(template_tasks=3))

    result = mod.build_plan(
        {"model": _model(), "template_path": str(template), "file_name": "План P-1"}
    )

    assert result["ok"] is True, result
    target = com["temp"] / "План P-1.mpp"
    assert result["path"] == str(target)
    assert result["file_name"] == "План P-1.mpp"
    assert result["template_used"] is True
    assert base64.b64decode(result["content_base64"]) == b"MPP-FILLED"
    assert result["size"] == len(b"MPP-FILLED")

    opened = Path(app.calls[0][1])
    assert app.calls[0][0] == "FileOpenEx" and app.calls[0][2] is False
    assert opened.parent == com["temp"] and opened.name.startswith("template_")
    assert not opened.exists()
    assert app.calls[1] == ("FileSaveAs", str(target))
    for call in app.calls:
        if call[0] in {"FileSaveAs", "FileSave"}:
            assert Path(call[1]) != template
    assert template.read_bytes() == b"TEMPLATE"
    assert app.names()[-2:] == ["FileCloseEx", "Quit"]
    assert ("FileCloseEx", 0) in app.calls
    assert app.Visible is False and app.DisplayAlerts is False
    assert com["pythoncom"].init == com["pythoncom"].uninit == 1

    tasks = _by_name(app)
    assert not any(name.startswith("Шаблонная") for name in tasks)
    assert list(tasks) == ["Работы", "Проектирование", "Монтаж", "Сдача", "Условия"]
    assert [t.OutlineLevel for t in tasks.values()] == [1, 2, 2, 2, 1]
    assert tasks["Работы"].Duration == 480
    assert tasks["Работы"].links == []
    assert tasks["Проектирование"].Duration == 960
    assert tasks["Проектирование"].Notes == "Согласовать с заказчиком"
    assert tasks["Проектирование"].ConstraintType == mod.PJ_SNET
    assert tasks["Проектирование"].ConstraintDate == datetime(2026, 11, 5, 8, 0, tzinfo=timezone.utc)
    assert tasks["Проектирование"].ResourceNames == "Петров П.П."
    assert tasks["Монтаж"].Duration == 720
    assert tasks["Монтаж"].ConstraintType == 0
    assert tasks["Монтаж"].links == [(tasks["Проектирование"], mod.PJ_FINISH_TO_START)]
    assert tasks["Монтаж"].ResourceNames == "Иванов"
    assert tasks["Сдача"].Milestone is True and tasks["Сдача"].Duration == 0
    assert tasks["Сдача"].links == [(tasks["Монтаж"], mod.PJ_FINISH_TO_START)]
    assert tasks["Условия"].Duration == 0 and tasks["Условия"].Milestone is False
    assert tasks["Условия"].ConstraintType == 0

    project = app.ActiveProject
    assert project.ProjectSummaryTask.Name == "Проект реконструкции"
    assert project.ProjectStart == datetime(2026, 11, 2, tzinfo=timezone.utc)
    resources = [r.Name for r in project.Resources.items]
    assert resources == ["Иванов", "Петров П.П."]
    marks = project.Calendar.marks
    assert marks[datetime(2026, 11, 4).date()] is False
    assert marks[datetime(2026, 11, 7).date()] is True


def test_build_plan_attached_app_is_not_quit(com, template: Path) -> None:
    app = com["install"](FakeApp(), running=True)
    app.Visible = True

    result = mod.build_plan({"model": _model(), "template_path": str(template), "file_name": "a"})

    assert result["ok"] is True, result
    assert "Quit" not in app.names()
    assert ("FileCloseEx", 0) in app.calls
    assert app.Visible is True


def test_build_plan_running_but_not_in_rot_is_not_quit(com, template: Path, monkeypatch) -> None:
    app = com["install"](FakeApp())
    monkeypatch.setattr(mod, "_winproj_pids", lambda: {4242})

    result = mod.build_plan({"model": _model(), "template_path": str(template), "file_name": "a"})

    assert result["ok"] is True
    assert "Quit" not in app.names()


def test_build_plan_without_template_uses_file_new(com, tmp_path: Path) -> None:
    app = com["install"](FakeApp())

    result = mod.build_plan(
        {"model": _model(), "template_path": str(tmp_path / "нет.mpp"), "file_name": "b.mpp"}
    )

    assert result["ok"] is True, result
    assert result["template_used"] is False
    assert "Шаблон недоступен" in result["note"]
    assert "FileOpenEx" not in app.names()
    assert app.calls[0] == ("FileNew",)
    assert ("FileSaveAs", str(com["temp"] / "b.mpp")) in app.calls
    assert base64.b64decode(result["content_base64"]) == b"MPP-SAVED-AS"
    assert "Quit" in app.names()


def test_build_plan_error_cleans_up_started_app(com, template: Path) -> None:
    app = com["install"](FakeApp(fail_add=True))

    result = mod.build_plan({"model": _model(), "template_path": str(template), "file_name": "c"})

    assert result["ok"] is False
    assert "Не удалось построить план в MS Project" in result["error"]
    assert "COM сломался" in result["error"]
    assert "FileSave" not in app.names()
    assert app.names()[-2:] == ["FileCloseEx", "Quit"]
    assert template.read_bytes() == b"TEMPLATE"
    assert com["pythoncom"].uninit == 1


def test_build_plan_rejects_missing_model(com) -> None:
    result = mod.build_plan({"template_path": "", "file_name": "x"})
    assert result == {"ok": False, "error": "Не передана модель плана (model)"}


def test_template_outline_reads_without_saving(com, template: Path, monkeypatch) -> None:
    app = FakeApp()
    original_open = app.FileOpenEx

    def open_with_tasks(path: str, read_only: bool) -> None:
        original_open(path, read_only)
        tasks = app.ActiveProject.Tasks
        tasks.items = [t for t in tasks.items if t is not None]
        summary = tasks.Add("Этап")
        summary.Summary = True
        summary.Duration = 2400
        child = tasks.Add("Работа")
        child.OutlineLevel = 2
        child.ResourceNames = "Иванов"
        milestone = tasks.Add("Веха")
        milestone.OutlineLevel = 2
        milestone.Duration = 0
        milestone.Milestone = True
        milestone.PredecessorTasks = [child]

    app.FileOpenEx = open_with_tasks
    com["install"](app)

    result = mod.template_outline({"template_path": str(template)})

    assert result["ok"] is True, result
    assert result["template_path"] == str(template)
    assert result["tasks"] == [
        {"name": "Этап", "level": 1, "duration_days": 5.0, "milestone": False, "summary": True,
         "predecessors": [], "resource": ""},
        {"name": "Работа", "level": 2, "duration_days": 1.0, "milestone": False, "summary": False,
         "predecessors": [], "resource": "Иванов"},
        {"name": "Веха", "level": 2, "duration_days": 0.0, "milestone": True, "summary": False,
         "predecessors": [1], "resource": ""},
    ]
    assert app.calls[0][0] == "FileOpenEx" and Path(app.calls[0][1]) != template
    assert not Path(app.calls[0][1]).exists()
    assert not {"FileSave", "FileSaveAs"} & set(app.names())
    assert app.names()[-2:] == ["FileCloseEx", "Quit"]
    assert template.read_bytes() == b"TEMPLATE"


def test_dialog_guard_timeout_kills_only_owned_project(monkeypatch) -> None:
    killed: list[int] = []
    monkeypatch.setattr(mod, "_kill_pid", killed.append)
    monkeypatch.setattr(mod, "_project_dialogs", lambda pids: [])
    session = mod._ProjectSession(None)
    session.owned_pids = {777}

    with mod._DialogGuard(session, timeout=0.6) as guard:
        deadline = datetime.now().timestamp() + 5
        while not guard.reason and datetime.now().timestamp() < deadline:
            pass

    assert "не ответил" in guard.reason
    assert killed == [777]


def test_dialog_guard_reports_unknown_dialog_without_killing_user_project(monkeypatch) -> None:
    killed: list[int] = []
    monkeypatch.setattr(mod, "_kill_pid", killed.append)
    monkeypatch.setattr(mod, "_answer_known_dialog", lambda hwnd, children: "")
    monkeypatch.setattr(
        mod, "_project_dialogs",
        lambda pids: [(1, "Microsoft Project", [(2, "Static", "Сохранить изменения?"), (3, "Button", "Да")])],
    )
    clock = {"now": 0.0}
    monkeypatch.setattr(mod.time, "monotonic", lambda: clock.__setitem__("now", clock["now"] + 1) or clock["now"])
    session = mod._ProjectSession(None)
    session.watched_pids = {555}

    with mod._DialogGuard(session, timeout=1000) as guard:
        deadline = datetime.now().timestamp() + 20
        while not guard.reason and datetime.now().timestamp() < deadline:
            pass

    assert guard.reason.startswith("MS Project ждёт ответа в окне «Microsoft Project»")
    assert "Сохранить изменения?" in guard.reason
    assert killed == []


def test_template_outline_missing_template(com, tmp_path: Path) -> None:
    result = mod.template_outline({"template_path": str(tmp_path / "нет.mpp")})
    assert result["ok"] is False
    assert "Шаблон недоступен" in result["error"]


def test_open_file_from_base64(com, monkeypatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(mod.os, "startfile", opened.append, raising=False)

    result = mod.open_file(
        {"content_base64": base64.b64encode(b"MPP").decode(), "file_name": "план"}
    )

    assert result["ok"] is True
    path = Path(result["path"])
    assert path == com["temp"] / "план.mpp"
    assert path.read_bytes() == b"MPP"
    assert opened == [str(path)]


def test_open_file_missing_path(com) -> None:
    result = mod.open_file({"path": "Z:/нет/такого.mpp"})
    assert result["ok"] is False
    assert "Файл не найден" in result["error"]


def test_tools_registered_and_map_errors(com) -> None:
    registry = ToolRegistry()
    register_msproject_tools(registry)
    assert {"msproject.build_plan", "msproject.template_outline", "msproject.open_file"} <= (
        registry.list_tool_names()
    )
    failed = registry.get("msproject.open_file").execute({})
    assert failed.ok is False
    assert "Не указан файл" in (failed.error_message or "")
