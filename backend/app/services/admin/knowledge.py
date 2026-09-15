"""Admin knowledge base from workflow files and regulation documents."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from app.db.session import SessionLocal
from app.models.regulation import RegulationDocument
from app.models.user import AppUser
from app.models.workflow import Workflow, WorkflowFile
from app.schemas.admin import AdminKnowledgeBaseOut, AdminKnowledgeRowOut, AdminFilterOut
from app.services.admin import stub_payloads
from app.services.admin.common import format_day, process_title, workflow_alive

_PAGE_SIZE = 5


def build_admin_knowledge_base() -> AdminKnowledgeBaseOut:
    chrome = stub_payloads.stub_knowledge_base()
    with SessionLocal() as db:
        rows, document = _load(db)
    types = sorted({row.type for row in rows})
    agents = sorted({part for row in rows for part in row.agents.split(", ") if part and part != "—"})
    statuses = sorted({row.status for row in rows})
    return AdminKnowledgeBaseOut(
        source="admin_api",
        breadcrumb=str(chrome["breadcrumb"]),
        title=str(chrome["title"]),
        subtitle=str(chrome["subtitle"]),
        add_label=str(chrome["addLabel"]),
        filters=[
            AdminFilterOut(id="type", options=["Все типы", *types]),
            AdminFilterOut(id="agent", options=["Все агенты", *agents[:40]]),
            AdminFilterOut(id="status", options=["Все статусы", *statuses]),
        ],
        rows=rows,
        pagination={"pageSize": _PAGE_SIZE, "total": len(rows)},
        document=document,
    )


def _load(db: Session) -> tuple[list[AdminKnowledgeRowOut], dict]:
    workflows = {
        row.id: row
        for row in db.execute(select(Workflow)).scalars().all()
        if workflow_alive(row)
    }
    users = {row.id: row for row in db.execute(select(AppUser)).scalars().all()}
    files = (
        db.execute(
            select(WorkflowFile)
            .options(
                load_only(
                    WorkflowFile.id,
                    WorkflowFile.workflow_id,
                    WorkflowFile.filename,
                    WorkflowFile.kind,
                    WorkflowFile.mime_type,
                    WorkflowFile.size,
                    WorkflowFile.extracted_text,
                    WorkflowFile.summary,
                    WorkflowFile.updated_at,
                    WorkflowFile.scope,
                )
            )
            .where(WorkflowFile.scope.in_(("knowledge", "document", "attachment")))
            .order_by(WorkflowFile.updated_at.desc())
            .limit(300)
        )
        .scalars()
        .all()
    )
    rows: list[AdminKnowledgeRowOut] = []
    preview: dict | None = None
    for item in files:
        workflow = workflows.get(item.workflow_id)
        agent_name = process_title(workflow) if workflow else "—"
        kind = _type_label(item.filename, item.kind, item.mime_type)
        status = "Актуален" if (item.extracted_text or item.summary or item.size > 0) else "Пустой"
        row = AdminKnowledgeRowOut(
            name=item.filename or "файл",
            type=kind,
            agents=agent_name,
            version="1",
            status=status,
            status_tone="success" if status == "Актуален" else "warning",
            updated_at=format_day(item.updated_at),
        )
        rows.append(row)
        if preview is None:
            owner = users.get(workflow.user_id) if workflow else None
            preview = _document_payload(
                title=row.name,
                status=row.status,
                status_tone=row.status_tone,
                kind=kind,
                updated=row.updated_at,
                text=(item.extracted_text or item.summary or "")[:1200] or "Текст не извлечён.",
                size=item.size,
                mime=item.mime_type,
                author=getattr(owner, "fio", None) or "—",
                agent=agent_name,
            )

    regulations = (
        db.execute(select(RegulationDocument).order_by(RegulationDocument.created_at.desc()).limit(80))
        .scalars()
        .all()
    )
    for doc in regulations:
        owner = users.get(doc.user_id)
        row = AdminKnowledgeRowOut(
            name=doc.file_name or "Регламент",
            type="Регламент",
            agents="—",
            version="1",
            status="Актуален",
            status_tone="success",
            updated_at=format_day(doc.created_at),
        )
        rows.append(row)
        if preview is None:
            preview = _document_payload(
                title=row.name,
                status=row.status,
                status_tone=row.status_tone,
                kind="Регламент",
                updated=row.updated_at,
                text="Загруженный регламент Constructor.",
                size=0,
                mime=doc.content_type,
                author=getattr(owner, "fio", None) or "—",
                agent="—",
            )

    chrome_doc = stub_payloads.stub_knowledge_base()["document"]
    return rows, preview or chrome_doc


def _type_label(filename: str, kind: str, mime: str) -> str:
    name = f"{filename} {kind} {mime}".casefold()
    if "регламент" in name or "regulat" in name:
        return "Регламент"
    if "шаблон" in name or "template" in name:
        return "Шаблон"
    if "pdf" in name:
        return "PDF"
    if kind in {"spreadsheet", "excel"} or "sheet" in name or name.endswith(".xlsx"):
        return "Таблица"
    return "Документ"


def _document_payload(
    *,
    title: str,
    status: str,
    status_tone: str,
    kind: str,
    updated: str,
    text: str,
    size: int,
    mime: str,
    author: str,
    agent: str,
) -> dict:
    size_label = f"{max(size, 0) / 1024:.1f} KB" if size else (mime or "файл")
    return {
        "title": title,
        "status": status,
        "statusTone": status_tone,
        "meta": f"{kind} • обновлён {updated}",
        "text": text,
        "format": size_label,
        "author": author,
        "category": kind,
        "tags": [kind.lower()],
        "usageTotal": "—",
        "usageTrend": "",
        "usageBars": [0, 0, 0, 0],
        "agentsShare": [{"label": agent, "value": 100}] if agent != "—" else [],
        "related": [],
        "relatedCount": 0,
    }
