"""Общий COM-слот виден другому процессу, не только потоку."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

from app.tools.ac.workers.com_machine_lock import machine_com_slot

_DESKTOP = Path(__file__).resolve().parents[1]


def test_second_process_waits_until_the_com_slot_is_free() -> None:
    script = (
        "import time\n"
        "from app.tools.ac.workers.com_machine_lock import machine_com_slot\n"
        "with machine_com_slot():\n"
        "    print('held', flush=True)\n"
        "    time.sleep(0.8)\n"
        "print('released', flush=True)\n"
    )
    env = os.environ.copy()
    env["PYTHONPATH"] = str(_DESKTOP) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONUNBUFFERED"] = "1"
    proc = subprocess.Popen(
        [sys.executable, "-c", script],
        cwd=_DESKTOP,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        held = proc.stdout.readline().strip() if proc.stdout is not None else ""
        assert held == "held"
        started = time.monotonic()
        with machine_com_slot():
            waited = time.monotonic() - started
        assert waited >= 0.4
    finally:
        proc.wait(timeout=5)
    assert proc.returncode == 0


def test_same_thread_can_enter_the_com_slot_twice() -> None:
    with machine_com_slot():
        with machine_com_slot():
            assert True
