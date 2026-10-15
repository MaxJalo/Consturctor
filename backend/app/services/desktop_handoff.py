"""One-time code so Orchestrator can open Constructor already signed in.

The code is not a JWT. It lives for a short time, works once, and is exchanged
for a Constructor session of the same user. An existing Constructor session id
is reused, so a running Constructor is not kicked off.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import time

from app.core.jwt import AuthContext, create_access_token
from app.schemas.auth import LoginResponse, UserOut
from app.services.auth_service import AuthError, get_current_user_profile
from app.services.sessions import current_session_id, new_session_id, replace_session

logger = logging.getLogger(__name__)

HANDOFF_TTL_SEC = 90
_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
_KEY = "constructor:desktop-handoff:{code}"
_memory: dict[str, tuple[float, dict[str, str]]] = {}


class HandoffError(Exception):
    def __init__(self, message: str, status_code: int = 410) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def handoff_url(code: str) -> str:
    return f"constructor://handoff?code={code}"


def _key(code: str) -> str:
    return _KEY.format(code=code)


def _redis():
    from app.services.sessions import _redis as session_redis

    return session_redis()


def _store_set(code: str, payload: dict[str, str]) -> None:
    client = _redis()
    if client is not None:
        client.set(_key(code), json.dumps(payload, ensure_ascii=False), ex=HANDOFF_TTL_SEC)
        return
    _memory[code] = (time.time() + HANDOFF_TTL_SEC, payload)


def _store_pop(code: str) -> dict[str, str] | None:
    client = _redis()
    if client is not None:
        key = _key(code)
        try:
            raw = client.getdel(key)
        except AttributeError:
            raw = client.get(key)
            if raw:
                client.delete(key)
        if not raw:
            return None
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    item = _memory.pop(code, None)
    if item is None:
        return None
    expires, payload = item
    if expires < time.time():
        return None
    return payload


def create_handoff(auth: AuthContext) -> str:
    user_id = (auth.user_id or "").strip()
    if not user_id:
        raise HandoffError("Нет пользователя для входа в конструктор", status_code=401)
    code = secrets.token_urlsafe(24)
    _store_set(
        code,
        {
            "user_id": user_id,
            "fio": (auth.fio or "").strip(),
            "department": (auth.department or "").strip(),
            "position": (auth.position or "").strip(),
        },
    )
    logger.info("desktop handoff created user=%s", user_id)
    return code


async def redeem_handoff(code: str) -> LoginResponse:
    value = (code or "").strip()
    if not _CODE_RE.fullmatch(value):
        raise HandoffError("Код входа в конструктор недействителен", status_code=400)
    payload = _store_pop(value)
    if not payload:
        raise HandoffError(
            "Код входа устарел. Нажмите «Открыть конструктор» ещё раз.",
            status_code=410,
        )
    user_id = str(payload.get("user_id") or "").strip()
    fio = str(payload.get("fio") or "").strip()
    if not user_id:
        raise HandoffError("Код входа в конструктор недействителен", status_code=400)
    try:
        user = await get_current_user_profile(user_id, fio or None)
    except AuthError:
        user = UserOut(
            id=user_id,
            fio=fio or user_id,
            department=str(payload.get("department") or ""),
            position=str(payload.get("position") or ""),
        )
    client = "constructor"
    existing = current_session_id(user.id, client)
    session_id = existing or new_session_id()
    if not existing:
        replace_session(user.id, session_id, client)
    token = create_access_token(
        user_id=user.id,
        fio=user.fio,
        department=user.department or "",
        position=user.position or "",
        session_id=session_id,
        client=client,
    )
    logger.info("desktop handoff redeemed user=%s", user.id)
    return LoginResponse(access_token=token, user=user)
