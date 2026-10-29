"""Короткое окно запросов и ресурсов процесса для экрана настройки.

Кольцо живёт в памяти этого процесса и не пишется в базу.
"""

from __future__ import annotations

import sys
import threading
import time
from collections import deque

_WINDOW_SEC = 600
_BUCKET_SEC = 15
_MAX_EVENTS = 4000
_MAX_LOGS = 200
_MAX_SAMPLES = 120

_lock = threading.Lock()
_events: deque[tuple[float, str, float, int]] = deque(maxlen=_MAX_EVENTS)
_logs: deque[tuple[float, str, str, str]] = deque(maxlen=_MAX_LOGS)
_samples: deque[tuple[float, float, float]] = deque(maxlen=_MAX_SAMPLES)
_last_sample_at = 0.0
_last_cpu: tuple[float, int] | None = None


def classify_path(path: str) -> str:
    lowered = path.lower()
    if any(part in lowered for part in ("imap", "/mail", "outlook")):
        return "mail"
    if any(part in lowered for part in ("onec", "docflow", "odata", "dok", "erp")):
        return "onec"
    return "server"


def record_http(method: str, path: str, status: int, elapsed_ms: float) -> None:
    if path.startswith("/health/metrics"):
        return
    module = classify_path(path)
    now = time.time()
    level = "error" if status >= 500 else "warn" if status >= 400 else "info"
    text = f"{method} {path} -> {status} за {elapsed_ms:.0f} мс"
    with _lock:
        _events.append((now, module, float(elapsed_ms), int(status)))
        if not path.startswith("/health"):
            _logs.append((now, level, module, text[:400]))
        _maybe_sample(now)


def snapshot() -> dict:
    now = time.time()
    with _lock:
        _maybe_sample(now)
        events = list(_events)
        logs = list(_logs)
        samples = list(_samples)
    return {
        "now": int(now * 1000),
        "modules": {
            name: _module_buckets(events, name, now) for name in ("server", "mail", "onec")
        },
        "resources": {
            "cpu": _sample_series(samples, now, 1),
            "memory_mb": _sample_series(samples, now, 2),
        },
        "logs": [
            {"t": int(ts * 1000), "level": level, "module": module, "text": text}
            for ts, level, module, text in logs
        ],
    }


def _module_buckets(events: list[tuple[float, str, float, int]], module: str, now: float) -> dict:
    slots = _WINDOW_SEC // _BUCKET_SEC
    start = now - _WINDOW_SEC
    counts = [0] * slots
    latency = [0.0] * slots
    for ts, name, elapsed_ms, _status in events:
        if name != module or ts < start:
            continue
        index = min(slots - 1, int((ts - start) / _BUCKET_SEC))
        counts[index] += 1
        latency[index] += elapsed_ms
    requests = []
    latency_ms = []
    for index, count in enumerate(counts):
        stamp = int((start + index * _BUCKET_SEC) * 1000)
        requests.append({"t": stamp, "v": count})
        latency_ms.append({"t": stamp, "v": round(latency[index] / count, 1) if count else 0})
    return {"requests": requests, "latency_ms": latency_ms}


def _sample_series(samples: list[tuple[float, float, float]], now: float, field: int) -> list[dict]:
    start = now - _WINDOW_SEC
    return [
        {"t": int(row[0] * 1000), "v": round(row[field], 1)}
        for row in samples
        if row[0] >= start
    ]


def _maybe_sample(now: float) -> None:
    global _last_sample_at
    if now - _last_sample_at < 5:
        return
    _last_sample_at = now
    cpu, memory = _process_usage(now)
    _samples.append((now, cpu, memory))


def _process_usage(now: float) -> tuple[float, float]:
    global _last_cpu
    proc = _process_time_100ns()
    cpu = 0.0
    if _last_cpu is not None and proc is not None:
        wall = max(1.0, (now - _last_cpu[0]) * 10_000_000)
        cpu = max(0.0, min(100.0, (proc - _last_cpu[1]) / wall * 100.0))
    if proc is not None:
        _last_cpu = (now, proc)
    return cpu, _memory_mb()


def _memory_mb() -> float:
    if sys.platform == "win32":
        return _windows_memory_mb()
    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux reports kilobytes, macOS bytes.
        if sys.platform == "darwin":
            return usage / (1024 * 1024)
        return usage / 1024
    except Exception:
        return 0.0


def _process_time_100ns() -> int | None:
    if sys.platform == "win32":
        return _windows_process_time()
    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF)
        return int((usage.ru_utime + usage.ru_stime) * 10_000_000)
    except Exception:
        return None


def _windows_process_time() -> int | None:
    try:
        import ctypes
        from ctypes import wintypes

        class FILETIME(ctypes.Structure):
            _fields_ = [("low", wintypes.DWORD), ("high", wintypes.DWORD)]

        kernel32 = ctypes.WinDLL("kernel32")
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        kernel32.GetProcessTimes.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(FILETIME),
            ctypes.POINTER(FILETIME),
            ctypes.POINTER(FILETIME),
            ctypes.POINTER(FILETIME),
        ]
        kernel32.GetProcessTimes.restype = wintypes.BOOL
        created, exited, kernel, user = FILETIME(), FILETIME(), FILETIME(), FILETIME()
        ok = kernel32.GetProcessTimes(
            kernel32.GetCurrentProcess(),
            ctypes.byref(created),
            ctypes.byref(exited),
            ctypes.byref(kernel),
            ctypes.byref(user),
        )
        if not ok:
            return None

        def ticks(value: FILETIME) -> int:
            return (int(value.high) << 32) + int(value.low)

        return ticks(kernel) + ticks(user)
    except Exception:
        return None


def _windows_memory_mb() -> float:
    try:
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("page_faults", wintypes.DWORD),
                ("peak_working_set", ctypes.c_size_t),
                ("working_set", ctypes.c_size_t),
                ("quota_peak_paged", ctypes.c_size_t),
                ("quota_paged", ctypes.c_size_t),
                ("quota_peak_nonpaged", ctypes.c_size_t),
                ("quota_nonpaged", ctypes.c_size_t),
                ("pagefile", ctypes.c_size_t),
                ("peak_pagefile", ctypes.c_size_t),
            ]

        kernel32 = ctypes.WinDLL("kernel32")
        psapi = ctypes.WinDLL("psapi")
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), wintypes.DWORD]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        counters = Counters()
        counters.cb = ctypes.sizeof(Counters)
        ok = psapi.GetProcessMemoryInfo(
            kernel32.GetCurrentProcess(),
            ctypes.byref(counters),
            ctypes.sizeof(Counters),
        )
        if not ok:
            return 0.0
        return counters.working_set / (1024 * 1024)
    except Exception:
        return 0.0
