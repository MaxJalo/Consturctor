"""Запуск процесса конфигурации: одна JSON-строка запроса в stdin, построчный JSON событий из stdout."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import threading
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Literal

from app import tool_settings
from app.config import settings
from app.platform import constructor_runs
from app.platform.approvals import approvals
from app.platform.attachments import Attachment
from app.platform.configs import PlatformConfig, find_config
from app.platform.metrics import Sampler
from app.platform.questions import questions
from app.platform.sessions import store
from app.skills.registry import materialize_skills

logger = logging.getLogger(__name__)

CANCEL_GRACE_SECONDS = 5.0
_STDERR_TAIL_LINES = 40
_SECRET_ENV = ("CURSOR_API_KEY", "CONSTRUCTOR_USER_PASSWORD")
# Эти события раннера порождает сам Cursor SDK, раннер уже записал их в журнал как sdk→runner.
_FROM_SDK = {"assistant", "thinking", "tool_call", "usage"}


class ConfigNotRunnable(RuntimeError):
    pass


class _Turn:
    def __init__(
        self,
        process: subprocess.Popen[bytes],
        turn: int,
        config: PlatformConfig,
        on_done: Callable[[], None] | None,
    ) -> None:
        self.process = process
        self.turn = turn
        self.config = config
        self.on_done = on_done
        self.stderr: deque[str] = deque(maxlen=_STDERR_TAIL_LINES)
        self.lock = threading.Lock()
        self.constructor_run_id = ""


_turns: dict[str, _Turn] = {}
_turns_lock = threading.Lock()
_explicit_stops: set[str] = set()
_steered_stops: set[str] = set()


def _active_turns() -> list[tuple[str, int, int]]:
    with _turns_lock:
        return [
            (session_id, turn.process.pid, turn.turn)
            for session_id, turn in _turns.items()
            if turn.process.poll() is None
        ]


sampler = Sampler(_active_turns)


def _command(config: PlatformConfig) -> list[str]:
    head, *rest = config.entry
    if head == "python":
        executable = sys.executable
    else:
        executable = shutil.which(head) or head
    folder = Path(config.path)
    args = [str(folder / part) if (folder / part).is_file() else part for part in rest]
    return [executable, *args]


def _environment(session_id: str) -> dict[str, str]:
    tool_settings.ensure_applied()
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    # MCP-сервер конфигурации ставит по ним вопросы человеку (ask_user).
    env["TURBOTESTER_API_URL"] = f"http://127.0.0.1:{settings.api_port}"
    env["TURBOTESTER_SESSION_ID"] = session_id
    session = store.get(session_id)
    if session is not None and session.test_tool:
        env["TURBOTESTER_TEST_TOOL"] = session.test_tool
    if settings.cursor_api_key:
        env["CURSOR_API_KEY"] = settings.cursor_api_key
    if settings.constructor_desktop_dir:
        env["CONSTRUCTOR_DESKTOP_DIR"] = settings.constructor_desktop_dir
    env["CONSTRUCTOR_API_URL"] = settings.constructor_api_url
    env["CONSTRUCTOR_USER_FIO"] = settings.constructor_user_fio
    env["CONSTRUCTOR_USER_PASSWORD"] = settings.constructor_user_password
    return env


def wait_idle(session_id: str, timeout: float = 15.0) -> bool:
    """Ход уже закончен, но раннер ещё закрывает агента: дождаться выхода процесса."""
    with _turns_lock:
        turn = _turns.get(session_id)
    if turn is None:
        return True
    try:
        turn.process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        return False
    return True


def start_turn(
    session_id: str,
    config: PlatformConfig,
    prompt: str,
    title: str,
    attachments: list[Attachment] | None = None,
    *,
    mode: Literal["agent", "chat", "plan"] = "agent",
    model: str = "",
    model_params: list[dict[str, str]] | None = None,
    skill_ids: list[str] | None = None,
    label: str = "",
    shown: str | None = None,
    on_done: Callable[[], None] | None = None,
) -> None:
    """Запустить ход. on_done вызывается после выхода процесса — в нём можно начать следующий ход."""
    if not config.runnable:
        raise ConfigNotRunnable(config.error or f"У конфигурации {config.title} нет entry в config.json")
    current = store.get(session_id)
    chosen_model = (model or (current.model if current else "") or config.model).strip()
    chosen_params = (
        list(model_params)
        if model_params is not None
        else (
            list(current.model_params)
            if current and current.model_params
            else [{"id": item.id, "value": item.value} for item in config.model_params]
        )
    )
    chosen_skills = list(skill_ids) if skill_ids is not None else (list(current.skill_ids) if current else [])
    store.set_turn_options(
        session_id,
        mode=mode,
        model=chosen_model,
        model_params=chosen_params,
        skill_ids=chosen_skills,
    )
    store.note_launch(session_id, model=chosen_model, entry=list(config.entry), config_path=config.path)
    files = list(attachments or [])
    session = store.begin_turn(session_id, prompt, files, label=label, planning=mode == "plan", shown=shown)
    workspace = store.workspace(session_id)
    materialize_skills(workspace, chosen_skills or None)
    request = {
        "type": "run",
        "sessionId": session_id,
        "mode": mode,
        "prompt": prompt,
        "attachments": [
            {"name": item.name, "path": str(workspace / item.path), "mime": item.mime, "image": item.image}
            for item in files
        ],
        "title": title,
        "model": chosen_model,
        "modelParams": chosen_params,
        "cwd": str(workspace),
        "resumeAgentId": session.sdk_agent_id,
        "python": sys.executable,
        "storeDir": str(store.sdk_store_dir(config.id)),
    }
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    command = _command(config)
    environment = _environment(session_id)
    try:
        process = subprocess.Popen(
            command,
            cwd=config.path,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            creationflags=flags,
        )
    except OSError as exc:
        store.release(session_id)
        store.finish(session_id, "error", f"Не удалось запустить {config.entry[0]}: {exc}")
        return
    store.trace(
        session_id,
        "platform→runner",
        "запуск процесса",
        text=f"PID {process.pid}: {' '.join(command)}",
        data={
            "command": command,
            "cwd": config.path,
            "env": {
                key: ("***" if key in _SECRET_ENV and environment.get(key) else environment.get(key, ""))
                for key in (
                    "CURSOR_API_KEY",
                    "CONSTRUCTOR_DESKTOP_DIR",
                    "CONSTRUCTOR_API_URL",
                    "CONSTRUCTOR_USER_FIO",
                    "CONSTRUCTOR_USER_PASSWORD",
                    "TURBOTESTER_TEST_TOOL",
                )
                if key in environment
            },
        },
    )
    turn = _Turn(process, session.turns, config, on_done)
    if session.workflow_id and not session.ephemeral:
        run_id = constructor_runs.start_run(session, shown if shown is not None else prompt)
        turn.constructor_run_id = run_id
        store.set_active_constructor_run(session_id, run_id)
    with _turns_lock:
        _explicit_stops.discard(session_id)
        _turns[session_id] = turn
    assert process.stdin is not None
    try:
        process.stdin.write((json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"))
        process.stdin.flush()
    except OSError:
        with _turns_lock:
            _turns.pop(session_id, None)
        try:
            _, stderr = process.communicate(timeout=5)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            stderr = b""
        lines = [line.strip() for line in stderr.decode("utf-8", errors="replace").splitlines() if line.strip()]
        reason = " · ".join(lines[-3:]) or f"код выхода {process.poll()}"
        store.release(session_id)
        store.finish(session_id, "error", f"Раннер {config.entry[0]} завершился до начала работы: {reason}")
        return
    store.trace(session_id, "platform→runner", "stdin: запрос запуска", text=prompt, data=request)
    sampler.ensure_started()
    threading.Thread(target=_read_stderr, args=(session_id, turn), daemon=True).start()
    threading.Thread(
        target=_read_stdout, args=(session_id, turn), daemon=True, name=f"platform-out-{session_id}"
    ).start()


def _write_cancel(session_id: str, turn: _Turn, *, keep_queue: bool) -> None:
    """Запись в stdin не должна держать HTTP: если раннер не читает канал, write блокируется."""
    try:
        with turn.lock:
            assert turn.process.stdin is not None
            turn.process.stdin.write(b'{"type":"cancel"}\n')
            turn.process.stdin.flush()
        store.trace(session_id, "platform→runner", "stdin: отмена", data={"type": "cancel", "steer": keep_queue})
    except OSError:
        pass


def cancel_turn(session_id: str, *, keep_queue: bool = False) -> bool:
    with _turns_lock:
        turn = _turns.get(session_id)
        if keep_queue:
            _steered_stops.add(session_id)
            _explicit_stops.discard(session_id)
        else:
            _explicit_stops.add(session_id)
            _steered_stops.discard(session_id)
    if not keep_queue:
        store.clear_queue(session_id)
    if turn is None or turn.process.poll() is not None:
        if not keep_queue:
            store.release(session_id)
            store.finish(session_id, "cancelled")
        return False
    if keep_queue:
        store.hold(session_id)
    # Таймер убийства ставится до записи в stdin: забитый канал не должен отменять остановку.
    threading.Timer(CANCEL_GRACE_SECONDS, _kill, args=(session_id, turn)).start()
    threading.Thread(
        target=_write_cancel, args=(session_id, turn), kwargs={"keep_queue": keep_queue}, daemon=True
    ).start()
    return True


def _kill(session_id: str, turn: _Turn) -> None:
    if turn.process.poll() is not None:
        return
    if sys.platform == "win32":
        # MCP-сервер — дочерний процесс раннера; без /T он переживёт отмену.
        subprocess.run(
            ["taskkill", "/PID", str(turn.process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    else:
        turn.process.kill()
    with _turns_lock:
        steered = session_id in _steered_stops
    if not steered:
        store.release(session_id)
        store.finish(session_id, "cancelled")


def _read_stderr(session_id: str, turn: _Turn) -> None:
    assert turn.process.stderr is not None
    for raw in turn.process.stderr:
        line = raw.decode("utf-8", errors="replace").rstrip()
        if line:
            turn.stderr.append(line)
            store.trace(session_id, "runner stderr", "stderr", text=f"{line}\n", merge=True)


def _route(session_id: str, event: dict[str, object]) -> None:
    kind = str(event.get("type") or "")
    if kind == "trace":
        store.trace(
            session_id,
            str(event.get("dir") or "runner"),
            str(event.get("kind") or ""),
            text=str(event.get("text") or ""),
            data=event.get("data"),
            merge=bool(event.get("merge")),
        )
        return
    if kind == "usage" and isinstance(event.get("usage"), dict):
        store.set_usage(session_id, event["usage"])  # type: ignore[arg-type]
    if kind == "status" and isinstance(event.get("tools"), list):
        store.set_tools(session_id, event["tools"])  # type: ignore[arg-type]
    if kind not in _FROM_SDK:
        store.trace(session_id, "runner→platform", kind, text=str(event.get("text") or ""), data=event)
    store.apply(session_id, event)


def _drain_queue(session_id: str, default_config: PlatformConfig) -> None:
    queued = store.pop_queued_message(session_id)
    if queued is None:
        return
    session = store.get(session_id)
    if session is None:
        return
    config = find_config(session.config_id) or default_config
    store.release(session_id)
    start_turn(
        session_id,
        config,
        queued.prompt,
        session.agent_title,
        queued.attachments,
        mode=queued.mode,
        model=queued.model or session.model,
        model_params=queued.model_params or session.model_params,
        skill_ids=queued.skill_ids or session.skill_ids,
        shown=queued.shown,
    )


def _read_stdout(session_id: str, turn: _Turn) -> None:
    assert turn.process.stdout is not None
    for raw in turn.process.stdout:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            turn.stderr.append(line)
            store.trace(session_id, "runner stderr", "stdout (не JSON)", text=f"{line}\n", merge=True)
            continue
        if not isinstance(event, dict):
            continue
        # Если поток упадёт, stdout раннера никто не читает: канал переполнится и агент встанет.
        try:
            _route(session_id, event)
        except Exception:
            logger.exception("platform: событие раннера %s не обработано", event.get("type"))
    code = turn.process.wait()
    questions.cancel(session_id)
    for dropped in approvals.cancel(session_id):
        store.settle_approval(session_id, dropped.id, "cancelled")
    store.trace(session_id, "runner→platform", "процесс завершён", text=f"код выхода {code}")
    try:
        assert turn.process.stdin is not None
        turn.process.stdin.close()
    except OSError:
        pass
    tail = "\n".join(list(turn.stderr)[-8:])
    message = f"Процесс конфигурации завершился с кодом {code}" + (f":\n{tail}" if tail else "")

    with _turns_lock:
        explicit_stop = session_id in _explicit_stops
        _explicit_stops.discard(session_id)
        steered = session_id in _steered_stops
        _steered_stops.discard(session_id)
        if _turns.get(session_id) is turn:
            del _turns[session_id]

    session_now = store.get(session_id)
    has_queued = bool(session_now and session_now.queued_messages) and not explicit_stop
    if steered or has_queued:
        store.hold(session_id)
    if code and not steered:
        store.release(session_id)
    final_status = "cancelled" if steered or explicit_stop else ("error" if code else "finished")
    store.finish(session_id, final_status, message if (code and not steered) else "")
    session_after = store.get(session_id)
    if session_after is not None and turn.constructor_run_id:
        constructor_runs.finish_run(
            session_after,
            turn.constructor_run_id,
            turn.turn,
            session_after.status if not steered else "cancelled",
            session_after.error if not steered else "",
        )
        store.set_active_constructor_run(session_id, "")

    if turn.on_done is not None and not explicit_stop and not steered:
        try:
            turn.on_done()
        except Exception as exc:
            logger.exception("platform follow-up failed for %s", session_id)
            store.release(session_id)
            store.finish(session_id, "error", f"Не удалось продолжить запуск: {exc}")
            return

    if has_queued:
        _drain_queue(session_id, turn.config)
    else:
        store.release(session_id)
