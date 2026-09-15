from __future__ import annotations

from app.services.onec_response_text import decode_http_body, format_onec_http_error, looks_like_garbled
import httpx


def test_decode_utf16_le_onec_error() -> None:
    msg = "Ошибка аутентификации пользователя"
    raw = msg.encode("utf-16-le")
    assert decode_http_body(raw) == msg


def test_decode_cp1251_snippet() -> None:
    raw = "Неверный пароль".encode("cp1251")
    assert "Неверный" in decode_http_body(raw)


def test_format_http_error_strips_binary() -> None:
    raw = b"\xff\xfe" + "Сущность не найдена".encode("utf-16-le")
    response = httpx.Response(404, content=raw, request=httpx.Request("GET", "http://x/doc"))
    text = format_onec_http_error(response, prefix="Документооборот OData")
    assert "404" in text
    assert "Сущность" in text or "не найдена" in text


def test_looks_like_garbled_binary_paths() -> None:
    assert looks_like_garbled("Users\\mdj\\AppData\\Local\\Temp\\v8_3A2F.tmp {HTTP 401}")
    assert not looks_like_garbled("Документооборот OData HTTP 404: сущность не найдена")
