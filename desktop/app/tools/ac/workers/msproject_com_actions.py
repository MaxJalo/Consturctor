"""MS Project через COM (MSProject.Application): построение плана из PlanModel."""

from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from app.tools.ac.workers import com_availability

PROGID = "MSProject.Application"
TEMP_SUBDIR = "constructor-msproject"
MINUTES_PER_DAY = 480
PJ_DO_NOT_SAVE = 0
PJ_FINISH_TO_START = 1
PJ_SNET = 4
COM_TIMEOUT_S = 240
_BM_CLICK = 0x00F5
_POOL_SKIP_LABELS = ("не открывать прочие", "do not open other")
_OK_LABELS = ("ок", "ok")

_PROJECT_LOCK = threading.Lock()
_INVALID_NAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def msproject_com_availability() -> tuple[bool, str]:
    """Проверить окружение для MS Project COM без запуска Project."""
    if not com_availability.is_windows():
        return False, "MS Project COM доступен только на Windows"
    if not com_availability.is_pywin32_available():
        return False, com_availability.get_com_unavailable_reason()
    if not _progid_registered():
        return False, "MS Project не установлен: ProgID MSProject.Application не зарегистрирован"
    return True, "MS Project COM доступен"


def is_msproject_com_available() -> bool:
    return msproject_com_availability()[0]


def _progid_registered() -> bool:
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, rf"{PROGID}\CLSID"):
            return True
    except OSError:
        return False
    except ImportError:
        return False


def _com_modules() -> tuple[Any, Any]:
    com_availability.ensure_pywin32_dll_path()
    import pythoncom
    import win32com.client

    return pythoncom, win32com.client


def _winproj_pids() -> set[int]:
    if sys.platform != "win32":
        return set()
    try:
        completed = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq WINPROJ.EXE", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:  # noqa: BLE001
        return set()
    pids: set[int] = set()
    for line in (completed.stdout or "").splitlines():
        parts = line.strip().strip('"').split('","')
        if len(parts) > 1 and parts[0].casefold() == "winproj.exe" and parts[1].isdigit():
            pids.add(int(parts[1]))
    return pids


def _kill_pid(pid: int) -> None:
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            capture_output=True,
            timeout=15,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:  # noqa: BLE001
        pass


def _project_dialogs(pids: set[int]) -> list[tuple[int, str, list[tuple[int, str, str]]]]:
    """Видимые модальные окна процессов MS Project: (hwnd, заголовок, [(hwnd, класс, текст)])."""
    if not pids:
        return []
    try:
        import win32gui
        import win32process
    except ImportError:
        return []
    found: list[tuple[int, str, list[tuple[int, str, str]]]] = []

    def on_window(hwnd: int, _: Any) -> bool:
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return True
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid not in pids:
                return True
            cls = win32gui.GetClassName(hwnd)
            if cls != "#32770" and "Dialog" not in cls:
                return True
            children: list[tuple[int, str, str]] = []

            def on_child(child: int, __: Any) -> bool:
                children.append((child, win32gui.GetClassName(child), win32gui.GetWindowText(child)))
                return True

            win32gui.EnumChildWindows(hwnd, on_child, None)
            found.append((hwnd, win32gui.GetWindowText(hwnd), children))
        except Exception:  # noqa: BLE001
            pass
        return True

    try:
        win32gui.EnumWindows(on_window, None)
    except Exception:  # noqa: BLE001
        return []
    return found


def _label(text: str) -> str:
    return text.replace("&", "").strip().casefold()


def _press(dialog: int, button: int) -> None:
    import win32con
    import win32gui

    control_id = win32gui.GetDlgCtrlID(button)
    win32gui.PostMessage(dialog, win32con.WM_COMMAND, (win32con.BN_CLICKED << 16) | control_id, button)


def _answer_known_dialog(dialog: int, children: list[tuple[int, str, str]]) -> str:
    """Ответить на известные безопасные вопросы Project; вернуть описание ответа или ''."""
    import win32con
    import win32gui

    labels = [(hwnd, _label(text)) for hwnd, cls, text in children if cls == "Button"]
    texts = " ".join(_label(text) for _, _, text in children)
    ok = next((hwnd for hwnd, text in labels if text in _OK_LABELS), 0)
    skip = next((hwnd for hwnd, text in labels if text.startswith(_POOL_SKIP_LABELS)), 0)
    if ok and skip:
        for hwnd, text in labels:
            if text.startswith(("открыть пул", "open resource pool")):
                win32gui.SendMessage(hwnd, win32con.BM_SETCHECK, win32con.BST_UNCHECKED, 0)
        win32gui.SendMessage(skip, win32con.BM_SETCHECK, win32con.BST_CHECKED, 0)
        _press(dialog, ok)
        return "пул ресурсов не открывали"
    yes = next((hwnd for hwnd, text in labels if text in ("да", "yes")), 0)
    if yes and ("серьезная ошибка" in texts or "serious error" in texts):
        _press(dialog, yes)
        return "повторное открытие временной копии подтверждено"
    return ""


class _DialogGuard:
    """Следит за окнами Project во время COM-вызовов: отвечает на известные вопросы,
    о неизвестных сообщает и по таймауту завершает только запущенный нами процесс."""

    def __init__(self, session: "_ProjectSession", timeout: float = COM_TIMEOUT_S) -> None:
        self._session = session
        self._timeout = timeout
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.reason = ""
        self.answers: list[str] = []

    def __enter__(self) -> "_DialogGuard":
        self._thread = threading.Thread(target=self._run, name="msproject-dialog-guard", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_: Any) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _abort(self, reason: str) -> None:
        self.reason = reason
        for pid in self._session.owned_pids:
            _kill_pid(pid)

    def _run(self) -> None:
        deadline = time.monotonic() + self._timeout
        seen: dict[int, float] = {}
        while not self._stop.wait(0.5):
            if time.monotonic() > deadline:
                self._abort(f"MS Project не ответил за {int(self._timeout)} с")
                return
            for hwnd, title, children in _project_dialogs(self._session.watched_pids):
                try:
                    answer = _answer_known_dialog(hwnd, children)
                except Exception:  # noqa: BLE001
                    answer = ""
                if answer:
                    self.answers.append(answer)
                    continue
                first = seen.setdefault(hwnd, time.monotonic())
                if time.monotonic() - first < 15:
                    continue
                text = " ".join(t for _, cls, t in children if cls != "Button" and t.strip())
                message = f"MS Project ждёт ответа в окне «{title}»: {text[:300]}".strip()
                if self._session.owned_pids:
                    self._abort(message)
                    return
                self.reason = message


def _temp_dir() -> Path:
    root = os.environ.get("TEMP") or tempfile.gettempdir()
    path = Path(root) / TEMP_SUBDIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_file_name(raw: object, fallback: str = "plan") -> str:
    name = Path(str(raw or "").strip()).name
    name = _INVALID_NAME_CHARS.sub("_", name).strip(" .")
    if not name:
        name = _INVALID_NAME_CHARS.sub("_", fallback).strip(" .") or "plan"
    if not name.casefold().endswith(".mpp"):
        name = f"{name}.mpp"
    return name


def _same_path(left: str | Path, right: str | Path) -> bool:
    try:
        return os.path.normcase(os.path.abspath(str(left))) == os.path.normcase(
            os.path.abspath(str(right))
        )
    except (OSError, ValueError):
        return False


def _template_accessible(template_path: str) -> tuple[bool, str]:
    if not template_path:
        return False, "Шаблон не указан"
    try:
        if not os.path.isfile(template_path):
            return False, f"Шаблон недоступен: {template_path}"
        with open(template_path, "rb") as handle:
            handle.read(1)
    except OSError as exc:
        return False, f"Шаблон недоступен: {template_path} ({exc})"
    return True, ""


def _remove_file(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def _parse_dt(value: object) -> datetime | None:
    """pywin32 сдвигает наивное время на локальный пояс; UTC-aware с тем же временем доходит без сдвига."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if len(text) == 10:
            parsed = date.fromisoformat(text)
            return datetime(parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc)
        naive = datetime.fromisoformat(text.replace("Z", "")).replace(tzinfo=None)
        return naive.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _fail(message: str) -> dict[str, Any]:
    return {"ok": False, "error": message}


class _ProjectSession:
    """Запуск/подключение к MS Project и гарантированная уборка за собой."""

    def __init__(self, client: Any) -> None:
        self._client = client
        self.app: Any = None
        self.started = False
        self.opened = False
        self.owned_pids: set[int] = set()
        self.watched_pids: set[int] = set()
        self._copies: list[Path] = []

    def start(self) -> Any:
        try:
            self.app = self._client.GetActiveObject(PROGID)
        except Exception:  # noqa: BLE001
            before = _winproj_pids()
            self.app = self._client.Dispatch(PROGID)
            self.started = not before
            if self.started:
                self.owned_pids = _winproj_pids() - before
        self.watched_pids = self.owned_pids or _winproj_pids()
        if self.started:
            self.app.Visible = False
        self.app.DisplayAlerts = False
        return self.app

    def open_template_copy(self, path: str) -> None:
        """Шаблон (часто общий сетевой файл) не открываем в Project: только его локальную копию
        с уникальным именем — так оригинал не блокируется и не меняется."""
        copy = _temp_dir() / f"template_{uuid.uuid4().hex[:12]}.mpp"
        shutil.copyfile(path, copy)
        self._copies.append(copy)
        self.app.FileOpenEx(str(copy), False)
        self.opened = True

    def new(self) -> None:
        self.app.FileNew()
        self.opened = True

    def close(self) -> None:
        if self.app is not None and self.opened:
            self.opened = False
            self.app.FileCloseEx(PJ_DO_NOT_SAVE)

    def finish(self) -> None:
        if self.app is None:
            return
        try:
            self.close()
        except Exception:  # noqa: BLE001
            pass
        if self.started:
            try:
                self.app.Quit(PJ_DO_NOT_SAVE)
            except Exception:  # noqa: BLE001
                pass
        self.app = None
        for copy in self._copies:
            for _ in range(10):
                try:
                    _remove_file(copy)
                    break
                except OSError:
                    time.sleep(0.5)
        self._copies = []


def _clear_tasks(project: Any) -> None:
    tasks = project.Tasks
    for index in range(int(tasks.Count or 0), 0, -1):
        try:
            task = tasks.Item(index)
        except Exception:  # noqa: BLE001
            continue
        if task is not None:
            task.Delete()


def _set_title(project: Any, title: str) -> None:
    if not title:
        return
    try:
        project.ProjectSummaryTask.Name = title
    except Exception:  # noqa: BLE001
        pass
    try:
        project.BuiltinDocumentProperties("Title").Value = title
    except Exception:  # noqa: BLE001
        pass


def _apply_calendar(project: Any, calendar: dict, warnings: list[str]) -> None:
    holidays = [d for d in (calendar.get("holidays") or []) if _parse_dt(d)]
    working = [d for d in (calendar.get("working_weekends") or []) if _parse_dt(d)]
    if not holidays and not working:
        return
    cal = project.Calendar
    for raw, is_working in [(d, False) for d in holidays] + [(d, True) for d in working]:
        try:
            cal.Period(_parse_dt(raw)).Working = is_working
        except Exception as exc:  # noqa: BLE001
            kind = "рабочий день" if is_working else "праздник"
            warnings.append(f"календарь {raw} ({kind}): {exc}")


def _ensure_resources(project: Any, model: dict) -> dict[str, str]:
    existing: set[str] = set()
    resources = project.Resources
    for index in range(1, int(resources.Count or 0) + 1):
        try:
            item = resources.Item(index)
        except Exception:  # noqa: BLE001
            continue
        if item is not None and item.Name:
            existing.add(str(item.Name).strip().casefold())
    by_key: dict[str, str] = {}
    for item in model.get("resources") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        key = str(item.get("key") or "").strip()
        if not name:
            continue
        if key:
            by_key[key] = name
        if name.casefold() not in existing:
            resources.Add(name)
            existing.add(name.casefold())
    for task in model.get("tasks") or []:
        if not isinstance(task, dict):
            continue
        name = str(task.get("resource_name") or "").strip()
        if name and name.casefold() not in existing:
            resources.Add(name)
            existing.add(name.casefold())
    return by_key


def _fill_project(project: Any, model: dict) -> list[str]:
    warnings: list[str] = []
    _set_title(project, str(model.get("title") or "").strip())
    project_start = _parse_dt(model.get("start"))
    if project_start is not None:
        project.ProjectStart = project_start
    calendar = model.get("calendar")
    if isinstance(calendar, dict):
        _apply_calendar(project, calendar, warnings)
    resource_by_key = _ensure_resources(project, model)

    created: dict[int, Any] = {}
    items: list[tuple[int, dict, Any]] = []
    prev_level = 0
    for item in model.get("tasks") or []:
        if not isinstance(item, dict):
            continue
        uid = int(item.get("uid") or 0)
        level = int(item.get("level") or 0)
        if level <= 0:
            continue
        level = min(level, prev_level + 1)
        prev_level = level
        task = project.Tasks.Add(str(item.get("name") or "").strip() or "Задача")
        task.OutlineLevel = level
        created[uid] = task
        items.append((uid, item, task))

    for uid, item, task in items:
        summary = bool(item.get("summary"))
        notes = str(item.get("notes") or "").strip()
        if notes:
            task.Notes = notes
        if summary:
            continue
        if item.get("milestone"):
            task.Duration = 0
            task.Milestone = True
        elif str(item.get("group") or "") == "conditions":
            task.Duration = 0
            task.Milestone = False
        else:
            days = float(item.get("duration_days") or 0)
            task.Duration = int(round(days * MINUTES_PER_DAY))
        preds = [int(p) for p in item.get("predecessors") or [] if int(p) in created and int(p) != uid]
        start = _parse_dt(item.get("start"))
        if not preds and start is not None and (
            project_start is None or start.date() != project_start.date()
        ):
            task.ConstraintType = PJ_SNET
            task.ConstraintDate = start
        resource_name = str(item.get("resource_name") or "").strip() or resource_by_key.get(
            str(item.get("resource") or "").strip(), ""
        )
        if resource_name:
            task.ResourceNames = resource_name

    for uid, item, task in items:
        seen: set[int] = set()
        for raw in item.get("predecessors") or []:
            pred_uid = int(raw)
            pred = created.get(pred_uid)
            if pred is None or pred_uid == uid or pred_uid in seen:
                continue
            seen.add(pred_uid)
            try:
                task.TaskDependencies.Add(pred, PJ_FINISH_TO_START)
            except Exception as exc:  # noqa: BLE001
                try:
                    current = str(task.Predecessors or "").strip()
                    task.Predecessors = f"{current},{pred.ID}" if current else str(pred.ID)
                except Exception:  # noqa: BLE001
                    warnings.append(f"связь «{item.get('name')}» ← {pred_uid}: {exc}")

    for _, item, task in items:
        if not item.get("summary") and not item.get("milestone") and not task.Duration:
            task.Milestone = False
    return warnings


def build_plan(input_data: dict) -> dict[str, Any]:
    """Собрать .mpp из PlanModel: шаблон только читаем, пишем копию во %TEMP%."""
    model = input_data.get("model")
    if not isinstance(model, dict):
        return _fail("Не передана модель плана (model)")
    available, reason = msproject_com_availability()
    if not available:
        return _fail(f"MS Project недоступен: {reason}")
    file_name = _safe_file_name(
        input_data.get("file_name"), str(model.get("code") or model.get("title") or "plan")
    )
    template_path = str(input_data.get("template_path") or "").strip()
    try:
        target = _temp_dir() / file_name
    except OSError as exc:
        return _fail(f"Не удалось подготовить временную папку для плана: {exc}")
    template_ok, template_reason = _template_accessible(template_path)
    if template_ok and _same_path(template_path, target):
        return _fail("Имя файла плана совпадает с шаблоном — шаблон нельзя перезаписывать")

    with _PROJECT_LOCK:
        pythoncom, client = _com_modules()
        pythoncom.CoInitialize()
        session = _ProjectSession(client)
        guard = _DialogGuard(session)
        try:
            app = session.start()
            with guard:
                if template_ok:
                    try:
                        session.open_template_copy(template_path)
                    except Exception as exc:  # noqa: BLE001
                        if guard.reason:
                            raise
                        session.opened = False
                        template_ok = False
                        template_reason = f"Не удалось открыть шаблон {template_path}: {exc}"
                if template_ok:
                    _remove_file(target)
                    app.FileSaveAs(str(target))
                    try:
                        app.ResourceSharing(False)
                    except Exception:  # noqa: BLE001
                        pass
                    project = app.ActiveProject
                    _clear_tasks(project)
                else:
                    session.new()
                    project = app.ActiveProject
                warnings = _fill_project(project, model)
                if template_ok:
                    app.FileSave()
                else:
                    _remove_file(target)
                    app.FileSaveAs(str(target))
                session.close()
            content = target.read_bytes()
        except Exception as exc:  # noqa: BLE001
            return _fail(f"Не удалось построить план в MS Project: {guard.reason or exc}")
        finally:
            session.finish()
            pythoncom.CoUninitialize()

    note_parts = [f"Шаблон: {template_path}" if template_ok else f"Без шаблона: {template_reason}"]
    if guard.answers:
        note_parts.append("Ответы Project: " + "; ".join(dict.fromkeys(guard.answers)))
    if warnings:
        note_parts.append("Предупреждения: " + "; ".join(warnings[:20]))
    result: dict[str, Any] = {
        "ok": True,
        "path": str(target),
        "file_name": file_name,
        "size": len(content),
        "content_base64": base64.b64encode(content).decode("ascii"),
        "template_used": template_ok,
        "note": ". ".join(note_parts),
    }
    if not template_ok:
        result["template_reason"] = template_reason
    return result


def template_outline(input_data: dict) -> dict[str, Any]:
    """Прочитать структуру задач шаблона без сохранения."""
    template_path = str(input_data.get("template_path") or "").strip()
    accessible, reason = _template_accessible(template_path)
    if not accessible:
        return _fail(reason)
    available, com_reason = msproject_com_availability()
    if not available:
        return _fail(f"MS Project недоступен: {com_reason}")

    with _PROJECT_LOCK:
        pythoncom, client = _com_modules()
        pythoncom.CoInitialize()
        session = _ProjectSession(client)
        guard = _DialogGuard(session)
        try:
            app = session.start()
            with guard:
                session.open_template_copy(template_path)
                tasks = _read_tasks(app.ActiveProject)
                session.close()
        except Exception as exc:  # noqa: BLE001
            return _fail(f"Не удалось прочитать шаблон MS Project: {guard.reason or exc}")
        finally:
            session.finish()
            pythoncom.CoUninitialize()
    return {"ok": True, "tasks": tasks, "template_path": template_path}


def _read_tasks(project: Any) -> list[dict[str, Any]]:
    collection = project.Tasks
    raw: list[Any] = []
    for index in range(1, int(collection.Count or 0) + 1):
        task = collection.Item(index)
        if task is not None:
            raw.append(task)
    index_by_id = {int(task.ID): position for position, task in enumerate(raw)}
    result: list[dict[str, Any]] = []
    for task in raw:
        predecessors: list[int] = []
        try:
            for pred in task.PredecessorTasks:
                position = index_by_id.get(int(pred.ID))
                if position is not None:
                    predecessors.append(position)
        except Exception:  # noqa: BLE001
            pass
        result.append(
            {
                "name": str(task.Name or ""),
                "level": int(task.OutlineLevel or 0),
                "duration_days": round(float(task.Duration or 0) / MINUTES_PER_DAY, 2),
                "milestone": bool(task.Milestone),
                "summary": bool(task.Summary),
                "predecessors": predecessors,
                "resource": str(task.ResourceNames or ""),
            }
        )
    return result


def open_file(input_data: dict) -> dict[str, Any]:
    """Открыть .mpp в Project пользователя (видимо, через ассоциацию файла)."""
    path_text = str(input_data.get("path") or "").strip()
    content = str(input_data.get("content_base64") or "").strip()
    try:
        if path_text:
            path = Path(path_text)
        elif content:
            path = _temp_dir() / _safe_file_name(input_data.get("file_name"))
            path.write_bytes(base64.b64decode(content))
        else:
            return _fail("Не указан файл: передайте path или content_base64")
        if not path.is_file():
            return _fail(f"Файл не найден: {path}")
        startfile = getattr(os, "startfile", None)
        if startfile is None:
            return _fail("Открытие файла в MS Project доступно только на Windows")
        startfile(str(path))
    except Exception as exc:  # noqa: BLE001
        return _fail(f"Не удалось открыть файл в MS Project: {exc}")
    return {"ok": True, "path": str(path)}


ACTIONS = {
    "msproject.build_plan": build_plan,
    "msproject.template_outline": template_outline,
    "msproject.open_file": open_file,
}
