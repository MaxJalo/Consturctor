from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.deps import require_admin_user
from app.core.jwt import AuthContext, create_access_token
from app.services.admin.overview import build_admin_overview


def test_require_admin_user_rejects_non_admin():
    auth = AuthContext(user_id="u1", fio="Обычный Пользователь", session_id="s1")
    with pytest.raises(HTTPException) as exc:
        require_admin_user(auth)
    assert exc.value.status_code == 403


def test_require_admin_user_allows_admin_fio():
    auth = AuthContext(
        user_id="u1",
        fio="Жалыбин Максим Дмитриевич",
        session_id="s1",
    )
    assert require_admin_user(auth) is auth


def test_build_admin_overview_has_metrics(monkeypatch):
    from app.schemas.admin import AdminAgentStatusesOut, AdminAgentStatusSliceOut
    from app.services.admin.common import empty_launch_dynamics

    statuses = AdminAgentStatusesOut(
        title="Статусы агентов",
        total=5,
        slices=[AdminAgentStatusSliceOut(id="active", label="Активные", value=5, color="#1a73e8")],
    )
    monkeypatch.setattr(
        "app.services.admin.overview._count_metrics",
        lambda: (5, 10, 2, 8, 1, 3, 4, (empty_launch_dynamics(), statuses)),
    )
    monkeypatch.setattr(
        "app.services.admin.overview._integration_items",
        lambda **_kwargs: [],
    )
    overview = build_admin_overview()
    assert overview.dashboard_title == "Сводная панель"
    assert len(overview.metrics) == 8
    assert overview.metrics[0].value == "5"
    assert overview.metrics[3].value == "10"


def test_admin_overview_route_requires_admin(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.schemas.admin import AdminAgentStatusesOut
    from app.services import sessions
    from app.services.admin.common import empty_launch_dynamics

    empty_statuses = AdminAgentStatusesOut(title="Статусы агентов", total=0, slices=[])
    monkeypatch.setattr(sessions, "is_current_session", lambda *_a, **_k: True)
    monkeypatch.setattr(
        "app.services.admin.overview._count_metrics",
        lambda: (0, 0, 0, 0, 0, 0, 0, (empty_launch_dynamics(), empty_statuses)),
    )
    monkeypatch.setattr("app.services.admin.overview._integration_items", lambda **_kwargs: [])

    token = create_access_token(
        user_id="user-regular",
        fio="Петров Петр Петрович",
        session_id="sess-1",
        client="orchestrator",
    )
    client = TestClient(app)
    response = client.get(
        "/api/v1/admin/overview",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403

    admin_token = create_access_token(
        user_id="admin-1",
        fio="Жалыбин Максим Дмитриевич",
        session_id="sess-2",
        client="orchestrator",
    )
    ok = client.get(
        "/api/v1/admin/overview",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["dashboardTitle"] == "Сводная панель"
    assert isinstance(body.get("metrics"), list)


def _admin_client(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.services import sessions

    monkeypatch.setattr(sessions, "is_current_session", lambda *_a, **_k: True)
    admin_token = create_access_token(
        user_id="admin-1",
        fio="Жалыбин Максим Дмитриевич",
        session_id="sess-admin",
        client="orchestrator",
    )
    return TestClient(app), admin_token


def test_admin_history_route_returns_stub(monkeypatch):
    from app.schemas.admin import AdminHistoryOut
    from app.services.admin import history as admin_history_service

    monkeypatch.setattr(
        admin_history_service,
        "build_admin_history",
        lambda: AdminHistoryOut.model_validate(
            {
                "source": "admin_api",
                "breadcrumb": "История",
                "title": "История",
                "subtitle": "sub",
                "period_label": "Период: Неделя",
                "date_range": "01.01.2026 — 07.01.2026",
                "tabs": [{"id": "processes", "label": "Процессы"}],
                "active_tab": "processes",
                "filters": [],
                "rows": [],
                "pagination": {"pageSize": 10, "total": 0},
            }
        ),
    )
    client, token = _admin_client(monkeypatch)
    response = client.get(
        "/api/v1/admin/history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body.get("source") == "admin_api"
    assert body.get("title") == "История"
    assert isinstance(body.get("rows"), list)


def test_history_tab_for_maps_trigger_kinds():
    from types import SimpleNamespace

    from app.services.admin.common import history_tab_for

    assert history_tab_for(SimpleNamespace(source="chat", trigger_kind="", trigger_reason="", message="")) == "processes"
    assert history_tab_for(SimpleNamespace(source="trigger", trigger_kind="interval", trigger_reason="", message="")) == "tasks"
    assert history_tab_for(SimpleNamespace(source="trigger", trigger_kind="mail", trigger_reason="", message="")) == "letters"
    assert (
        history_tab_for(
            SimpleNamespace(source="trigger", trigger_kind="", trigger_reason="turboproject", message="")
        )
        == "project_tasks"
    )


def test_admin_users_route_returns_admin_api(monkeypatch):
    from app.schemas.admin import AdminUsersOut
    from app.services.admin import users as admin_users_service

    monkeypatch.setattr(
        admin_users_service,
        "build_admin_users",
        lambda: AdminUsersOut.model_validate(
            {
                "source": "admin_api",
                "breadcrumb": "Пользователи",
                "title": "Пользователи",
                "subtitle": "sub",
                "add_label": "Добавить",
                "filters": [],
                "rows": [],
                "pagination": {"pageSize": 5, "total": 0},
            }
        ),
    )
    client, token = _admin_client(monkeypatch)
    response = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json().get("source") == "admin_api"
