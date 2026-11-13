"""Вход на внешний заказ добавляет сотруднику недостающих агентов и не плодит копии."""

from __future__ import annotations

from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.models.user import AppUser
from app.models.workflow import Workflow
from app.services.external_order_agent import TITLE as ORDER_TITLE
from app.services.external_purchase_agent import TITLE as PURCHASE_TITLE
from app.services.external_service_agents import grant_order_agents


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)()


def _titles(db: Session, user_id: str) -> list[str]:
    rows = (
        db.query(Workflow.title)
        .filter(Workflow.user_id == user_id, Workflow.phase == "done")
        .all()
    )
    return sorted(str(title) for (title,) in rows)


def test_opening_external_order_adds_missing_agents_once() -> None:
    db = _session()
    db.add(AppUser(id="owner", fio="Жалыбин Максим Дмитриевич"))
    db.add(
        AppUser(
            id="arsunoev",
            fio="Арсуноев Михаил Магомедович",
            position="Заместитель директора по качеству",
            department="Зам. технического директора по качеству",
        )
    )
    db.commit()

    added = grant_order_agents(db, "arsunoev")
    titles = _titles(db, "arsunoev")

    assert ORDER_TITLE in titles
    assert PURCHASE_TITLE in titles
    assert ORDER_TITLE in added
    assert PURCHASE_TITLE in added
    assert len(titles) == len(set(titles))

    again = grant_order_agents(db, "arsunoev")
    assert again == []
    assert _titles(db, "arsunoev") == titles

    owner_copies = (
        db.query(func.count())
        .select_from(Workflow)
        .filter(Workflow.user_id == "owner", Workflow.title == ORDER_TITLE, Workflow.phase == "done")
        .scalar()
    )
    assert owner_copies == 1
