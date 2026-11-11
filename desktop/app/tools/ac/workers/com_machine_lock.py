"""Один слот COM на сессию Windows.

threading.Lock виден только своему процессу. Агенты живут в разных процессах,
поэтому без общего мьютекса они одновременно вызывают один Outlook, MS Project
или 1С и вешают рабочий стол. Мьютекс сессии стоит вокруг самого вызова COM.
Ходы модели его не берут.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import win32api
import win32event

MUTEX_NAME = r"Local\OrchestratorCom"


@contextmanager
def machine_com_slot() -> Iterator[None]:
    """Дождаться очереди и держать единственный COM-слот этой сессии Windows.

    Повторный вход с того же потока увеличивает счётчик мьютекса и отпускает
    его столько же раз. Упавший владелец оставляет WAIT_ABANDONED: слот
    достаётся следующему, очередь не застревает.
    """
    handle = win32event.CreateMutex(None, False, MUTEX_NAME)
    acquired = False
    try:
        result = win32event.WaitForSingleObject(handle, win32event.INFINITE)
        if result not in (win32event.WAIT_OBJECT_0, win32event.WAIT_ABANDONED):
            raise TimeoutError("COM занят другим агентом и очередь не дождалась слота")
        acquired = True
        yield
    finally:
        if acquired:
            win32event.ReleaseMutex(handle)
        win32api.CloseHandle(handle)
