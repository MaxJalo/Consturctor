"""Карточка документа и граф его жизненного цикла.

Протокол сюда не входит: у него нет класса в разделе 4 концепции.
Договоры, ЛНА, кадры, первичка, проектные и конструкторские документы
имеют описание статусов, но карточки пилота для них не создаются.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DocflowClass(Base):
    __tablename__ = "docflow_classes"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    pilot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    execution: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class DocflowStatus(Base):
    __tablename__ = "docflow_statuses"
    __table_args__ = (UniqueConstraint("class_code", "code", name="uq_docflow_status_code"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    class_code: Mapped[str] = mapped_column(
        String(32), ForeignKey("docflow_classes.code"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    optional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class DocflowEdge(Base):
    __tablename__ = "docflow_edges"
    __table_args__ = (UniqueConstraint("from_status_id", "to_status_id", name="uq_docflow_edge"),)

    id: Mapped[str] = mapped_column(String(140), primary_key=True)
    class_code: Mapped[str] = mapped_column(
        String(32), ForeignKey("docflow_classes.code"), nullable=False, index=True
    )
    from_status_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("docflow_statuses.id"), nullable=False
    )
    to_status_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("docflow_statuses.id"), nullable=False
    )
    branch: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    reason_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    author_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class DocflowDocument(Base):
    __tablename__ = "docflow_documents"
    __table_args__ = (
        Index(
            "uq_docflow_documents_onec_ref",
            "onec_entity",
            "onec_ref_key",
            unique=True,
            postgresql_where=text("onec_ref_key <> ''"),
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    class_code: Mapped[str] = mapped_column(
        String(32), ForeignKey("docflow_classes.code"), nullable=False, index=True
    )
    status_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("docflow_statuses.id"), nullable=False, index=True
    )
    legal_entity: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    title: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    author_fio: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    author_user_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    reg_number: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    reg_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    onec_entity: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    onec_ref_key: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    onec_number: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    onec_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DocflowEvent(Base):
    __tablename__ = "docflow_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("docflow_documents.id"),
        nullable=False,
        index=True,
    )
    actor_user_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    actor_fio: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    from_status: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DocflowFile(Base):
    __tablename__ = "docflow_files"
    __table_args__ = (
        UniqueConstraint("document_id", "sha256", name="uq_docflow_file_sha"),
        Index(
            "uq_docflow_file_onec_ref",
            "document_id",
            "onec_file_ref",
            unique=True,
            postgresql_where=text("onec_file_ref <> ''"),
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("docflow_documents.id"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    onec_file_ref: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DocflowLink(Base):
    __tablename__ = "docflow_links"
    __table_args__ = (
        UniqueConstraint("from_document_id", "to_document_id", "kind", name="uq_docflow_link"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    from_document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("docflow_documents.id"), nullable=False, index=True
    )
    to_document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("docflow_documents.id"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)


class DocflowParty(Base):
    __tablename__ = "docflow_parties"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("docflow_documents.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    person_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    person_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")


def _doc_id() -> Mapped[str]:
    return mapped_column(String(64), ForeignKey("docflow_documents.id"), primary_key=True)


class DocflowIncoming(Base):
    __tablename__ = "docflow_incoming"

    document_id: Mapped[str] = _doc_id()
    sender_number: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    channel: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    track: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    resolution: Mapped[str] = mapped_column(Text, nullable=False, default="")


class DocflowOutgoing(Base):
    __tablename__ = "docflow_outgoing"

    document_id: Mapped[str] = _doc_id()
    addressee_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    delivery_channel: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class DocflowOrder(Base):
    __tablename__ = "docflow_order"

    document_id: Mapped[str] = _doc_id()
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="order")


class DocflowLna(Base):
    __tablename__ = "docflow_lna"

    document_id: Mapped[str] = _doc_id()
    basis_order_number: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class DocflowMemo(Base):
    __tablename__ = "docflow_memo"

    document_id: Mapped[str] = _doc_id()
    addressee_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")


class DocflowContract(Base):
    __tablename__ = "docflow_contract"

    document_id: Mapped[str] = _doc_id()
    counterparty: Mapped[str] = mapped_column(String(256), nullable=False, default="")


class DocflowHr(Base):
    __tablename__ = "docflow_hr"

    document_id: Mapped[str] = _doc_id()
    employee_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    hr_kind: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class DocflowAccounting(Base):
    __tablename__ = "docflow_accounting"

    document_id: Mapped[str] = _doc_id()
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="")


class DocflowProject(Base):
    __tablename__ = "docflow_project"

    document_id: Mapped[str] = _doc_id()
    turboproject_key: Mapped[str] = mapped_column(String(128), nullable=False, default="")


class DocflowEngineering(Base):
    __tablename__ = "docflow_engineering"

    document_id: Mapped[str] = _doc_id()
    litera: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    notice_number: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class DocflowAssignment(Base):
    __tablename__ = "docflow_assignment"

    document_id: Mapped[str] = _doc_id()
    result_text: Mapped[str] = mapped_column(Text, nullable=False, default="")


EXTENSION_MODELS = {
    "incoming": DocflowIncoming,
    "outgoing": DocflowOutgoing,
    "order": DocflowOrder,
    "lna": DocflowLna,
    "memo": DocflowMemo,
    "contract": DocflowContract,
    "hr": DocflowHr,
    "accounting": DocflowAccounting,
    "project": DocflowProject,
    "engineering": DocflowEngineering,
    "assignment": DocflowAssignment,
}
