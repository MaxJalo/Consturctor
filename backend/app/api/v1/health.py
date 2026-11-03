from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter

from app.clients.erp_sql import ErpSqlError, ping
from app.config import settings
from app.schemas.health import HealthResponse

logger = logging.getLogger(__name__)
router = APIRouter()

# Every desktop client polls /health. The window gives up at 8s, while the first
# ODBC login often takes about that long, so the tile showed «нет ответа» on a
# live server. The last verdict is reused; a refresh never holds the response.
_PING_TTL = 15.0
_PING_WAIT = 8.0
_ping_cache: tuple[float, bool] | None = None
_ping_task: asyncio.Task[None] | None = None


async def _refresh_ping() -> None:
    global _ping_cache
    reachable = False
    try:
        reachable = await asyncio.wait_for(asyncio.to_thread(ping), timeout=_PING_WAIT)
    except TimeoutError:
        logger.warning("ERP health check timed out")
    except ErpSqlError:
        logger.warning("ERP health check failed", exc_info=True)
    except Exception:
        logger.warning("Unexpected ERP health check error", exc_info=True)
    _ping_cache = (time.monotonic(), bool(reachable))


def _schedule_ping() -> None:
    global _ping_task
    if _ping_task is not None and not _ping_task.done():
        return
    _ping_task = asyncio.create_task(_refresh_ping())


async def _erp_reachable() -> bool:
    """Return the last ERP verdict without waiting on ODBC."""
    now = time.monotonic()
    cached = _ping_cache
    fresh = cached is not None and now - cached[0] < _PING_TTL
    if fresh and cached is not None:
        return cached[1]
    _schedule_ping()
    if cached is not None:
        return cached[1]
    task = _ping_task
    if task is not None:
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=1.5)
        except TimeoutError:
            pass
    cached = _ping_cache
    return bool(cached[1]) if cached is not None else False


@router.get("/health/live")
async def health_live() -> dict[str, str]:
    """Uvicorn is up — no erp_pm ODBC (for dev scripts / desktop startup)."""
    return {"status": "ok"}


@router.get("/health/metrics")
async def health_metrics() -> dict:
    """Кольцо запросов и ресурсов этого процесса. Без секретов и без строки запроса."""
    from app.services.runtime_metrics import snapshot

    return snapshot()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    erp_reachable = await _erp_reachable()
    # No verdict yet means the ping is still running, not that the server is down.
    known = _ping_cache is not None
    return HealthResponse(
        status="ok" if erp_reachable or not known else "degraded",
        erp_reachable=erp_reachable,
        erp_server=settings.erp_sql_server,
        llm_provider=settings.llm_provider,
    )
