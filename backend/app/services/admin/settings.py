from __future__ import annotations

from app.schemas.admin import AdminSettingsOut
from app.services.admin import stub_payloads


def build_admin_settings() -> AdminSettingsOut:
    chrome = stub_payloads.stub_settings()
    return AdminSettingsOut(
        source="admin_api",
        breadcrumb=str(chrome["breadcrumb"]),
        title=str(chrome["title"]),
        subtitle=str(chrome["subtitle"]),
    )
