"""Decode and shorten 1C platform HTTP error bodies (UTF-16, cp1251, JSON)."""

from __future__ import annotations

import json
import re

import httpx

_CYRILLIC = re.compile(r"[\u0400-\u04FF]")


def decode_http_body(raw: bytes) -> str:
    if not raw:
        return ""
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        for enc in ("utf-16-le", "utf-16-be"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
    sample = raw[: min(len(raw), 400)]
    if b"\x00" in sample:
        try:
            return raw.decode("utf-16-le")
        except UnicodeDecodeError:
            pass
    for enc in ("utf-8-sig", "utf-8", "cp1251", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def sanitize_onec_error_snippet(text: str, *, max_len: int = 220) -> str:
    cleaned = "".join(ch if ch >= " " or ch in "\n\t" else " " for ch in (text or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return ""
    head = cleaned.split("{", 1)[0].strip()
    if len(head) > max_len:
        head = head[: max_len - 1].rstrip() + "…"
    return head


def looks_like_garbled(text: str) -> bool:
    snippet = (text or "").strip()
    if not snippet:
        return True
    if "\ufffd" in snippet or "�" in snippet:
        return True
    cyr = len(_CYRILLIC.findall(snippet))
    if cyr >= 8:
        return False
    if cyr == 0 and len(snippet) > 40:
        return True
    return False


def format_onec_http_error(
    response: httpx.Response,
    *,
    prefix: str = "1C OData",
) -> str:
    text = decode_http_body(response.content).lstrip("\ufeff")
    try:
        data = json.loads(text)
        exc = data.get("exception")
        if isinstance(exc, dict):
            desc = str(exc.get("descr") or exc.get("desc") or "").strip()
            if desc:
                desc = sanitize_onec_error_snippet(desc, max_len=300)
                if desc:
                    return f"{prefix} HTTP {response.status_code}: {desc}"
    except json.JSONDecodeError:
        pass
    snippet = sanitize_onec_error_snippet(text, max_len=280)
    if snippet and not looks_like_garbled(snippet):
        return f"{prefix} HTTP {response.status_code}: {snippet}"
    return f"{prefix} HTTP {response.status_code}"
