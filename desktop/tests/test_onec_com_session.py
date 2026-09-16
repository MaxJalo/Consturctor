"""Tests for Orchestrator → COM credential merge (no real 1C)."""

from __future__ import annotations

from app.tools.ac.workers import onec_com_session as session


def test_session_fio_password_clears_name_mail_as_com_usr() -> None:
    env: dict[str, str] = {
        "ONEC_COM_USR": "zhalybin_md",
        "ERP_LOGIN": "old",
        "ERP_PASSWORD": "oldpwd",
    }
    snapshot = {"ONEC_COM_USR": "", "ERP_LOGIN": "", "ERP_PASSWORD": ""}
    session.apply_onec_session_credentials(
        {
            "fio": "Жалыбин Максим Дмитриевич",
            "password": "secret",
            "username": "zhalybin_md",
            "name_mail": "zhalybin_md",
            "onec_com_usr": "zhalybin_md",
        },
        desktop_snapshot=snapshot,
        environ=env,
    )
    assert "ONEC_COM_USR" not in env
    assert env["ERP_LOGIN"] == "Жалыбин Максим Дмитриевич"
    assert env["ERP_PASSWORD"] == "secret"


def test_desktop_env_onec_com_usr_preserved() -> None:
    env: dict[str, str] = {"ERP_LOGIN": "", "ERP_PASSWORD": ""}
    snapshot = {"ONEC_COM_USR": "service_account", "ERP_LOGIN": "", "ERP_PASSWORD": ""}
    session.apply_onec_session_credentials(
        {"fio": "Жалыбин Максим Дмитриевич", "password": "secret"},
        desktop_snapshot=snapshot,
        environ=env,
    )
    assert env["ONEC_COM_USR"] == "service_account"
    assert env["ERP_LOGIN"] == "Жалыбин Максим Дмитриевич"


def test_explicit_override_wins_without_desktop_usr() -> None:
    env: dict[str, str] = {}
    snapshot = {"ONEC_COM_USR": "", "ERP_LOGIN": "", "ERP_PASSWORD": ""}
    session.apply_onec_session_credentials(
        {
            "fio": "Жалыбин Максим Дмитриевич",
            "password": "secret",
            "onec_com_usr_override": "latin_login",
        },
        desktop_snapshot=snapshot,
        environ=env,
    )
    assert env["ONEC_COM_USR"] == "latin_login"


def test_com_session_auth_ready_requires_password_when_login_set() -> None:
    env = {
        "ONEC_COM_SERVER": "srv",
        "ONEC_COM_REF": "erp_pm",
        "ERP_LOGIN": "Жалыбин Максим Дмитриевич",
        "ERP_PASSWORD": "",
    }
    assert not session.com_session_auth_ready(env)
    env["ERP_PASSWORD"] = "x"
    assert session.com_session_auth_ready(env)


def test_connection_string_uses_fio_when_no_com_usr(monkeypatch) -> None:
    from app.tools.ac.workers import onec_com32_helper as helper

    monkeypatch.setenv("ONEC_COM_SERVER", "srv")
    monkeypatch.setenv("ONEC_COM_REF", "erp_pm")
    monkeypatch.delenv("ONEC_COM_USR", raising=False)
    monkeypatch.setenv("ERP_LOGIN", "Жалыбин Максим Дмитриевич")
    monkeypatch.setenv("ERP_PASSWORD", "secret")
    conn = helper.connection_string()
    assert "Usr=" in conn
    assert "Жалыбин" in conn
    assert "zhalybin" not in conn.casefold()
