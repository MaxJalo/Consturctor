import asyncio

from app.core.jwt import AuthContext, validate_token
from app.schemas.auth import UserOut
from app.services import desktop_handoff
from app.services.desktop_handoff import HandoffError, create_handoff, redeem_handoff


def _auth() -> AuthContext:
    return AuthContext(
        user_id="u-1",
        fio="Иванов Иван",
        department="Отдел",
        position="Инженер",
        session_id="sid-orch",
        client="orchestrator",
    )


def _isolate_store(monkeypatch) -> None:
    desktop_handoff._memory.clear()
    monkeypatch.setattr(desktop_handoff, "_redis", lambda: None)


def test_handoff_redeems_once_as_constructor_session(monkeypatch) -> None:
    _isolate_store(monkeypatch)

    async def profile(user_id: str, fio: str | None = None) -> UserOut:
        return UserOut(id=user_id, fio=fio or "Иванов Иван", department="Отдел", position="Инженер")

    monkeypatch.setattr(desktop_handoff, "get_current_user_profile", profile)
    monkeypatch.setattr(desktop_handoff, "current_session_id", lambda *_args, **_kwargs: "")
    replaced: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        desktop_handoff,
        "replace_session",
        lambda user_id, session_id, client="constructor": replaced.append((user_id, session_id, client)),
    )

    code = create_handoff(_auth())
    assert desktop_handoff.handoff_url(code).startswith("constructor://handoff?code=")

    result = asyncio.run(redeem_handoff(code))
    auth = validate_token(result.access_token)
    assert auth.user_id == "u-1"
    assert auth.client == "constructor"
    assert auth.fio == "Иванов Иван"
    assert auth.session_id
    assert auth.session_id != "sid-orch"
    assert replaced == [("u-1", auth.session_id, "constructor")]

    try:
        asyncio.run(redeem_handoff(code))
        raise AssertionError("second redeem must fail")
    except HandoffError as exc:
        assert exc.status_code == 410


def test_handoff_reuses_live_constructor_session(monkeypatch) -> None:
    _isolate_store(monkeypatch)

    async def profile(user_id: str, fio: str | None = None) -> UserOut:
        return UserOut(id=user_id, fio=fio or "Иванов Иван", department="Отдел", position="Инженер")

    monkeypatch.setattr(desktop_handoff, "get_current_user_profile", profile)
    monkeypatch.setattr(
        desktop_handoff,
        "current_session_id",
        lambda _user_id, client="constructor": "sid-ctor" if client == "constructor" else "",
    )

    def boom(*_args, **_kwargs):
        raise AssertionError("existing constructor session must stay")

    monkeypatch.setattr(desktop_handoff, "replace_session", boom)
    code = create_handoff(_auth())
    result = asyncio.run(redeem_handoff(code))
    assert validate_token(result.access_token).session_id == "sid-ctor"
    assert validate_token(result.access_token).client == "constructor"
