from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.api import deps
from app.core.jwt import create_access_token
from app.services.sessions import replace_session


def test_get_current_user_honors_session_lock(monkeypatch) -> None:
    store: dict[str, str] = {}

    class FakeRedis:
        def set(self, key, value, ex=None):
            store[key] = value

        def get(self, key):
            return store.get(key)

        def delete(self, key):
            store.pop(key, None)

        def ping(self):
            return True

    fake = FakeRedis()
    monkeypatch.setattr("app.services.sessions._redis", lambda: fake)
    monkeypatch.setattr("app.services.sessions._client", fake)
    monkeypatch.setattr(deps.settings, "auth_skip_session_lock", False)

    replace_session("u-1", "sid-live", "orchestrator")
    token = create_access_token(
        user_id="u-1",
        fio="Test",
        session_id="sid-stale",
        client="orchestrator",
    )
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(HTTPException) as exc:
        deps.get_current_user(creds)
    assert exc.value.status_code == 401
    assert "другом устройстве" in str(exc.value.detail)


def test_get_current_user_skips_lock_when_configured(monkeypatch) -> None:
    store: dict[str, str] = {}

    class FakeRedis:
        def set(self, key, value, ex=None):
            store[key] = value

        def get(self, key):
            return store.get(key)

        def delete(self, key):
            store.pop(key, None)

        def ping(self):
            return True

    fake = FakeRedis()
    monkeypatch.setattr("app.services.sessions._redis", lambda: fake)
    monkeypatch.setattr("app.services.sessions._client", fake)
    monkeypatch.setattr(deps.settings, "auth_skip_session_lock", True)

    replace_session("u-1", "sid-live", "orchestrator")
    token = create_access_token(
        user_id="u-1",
        fio="Test",
        session_id="sid-stale",
        client="orchestrator",
    )
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    auth = deps.get_current_user(creds)
    assert auth.user_id == "u-1"
    assert auth.session_id == "sid-stale"
