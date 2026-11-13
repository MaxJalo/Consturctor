"""Банк умений: список только своей службы, пустое название не создаёт запись."""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.models import agent_skill as _agent_skill  # noqa: F401
from app.services.agent_skills import SkillError, create_skill, list_skills


def _db() -> Session:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)()


def test_list_returns_only_the_requested_role() -> None:
    db = _db()
    create_skill(db, title="Сроки поставки", body="Проверь сроки.", role="omto", author="Иванов")
    create_skill(db, title="Сделать ТКП", body="Собери ТКП.", role="production", author="Иванов")
    titles = [row.title for row in list_skills(db, "omto")]
    assert titles == ["Сроки поставки"]


def test_empty_title_is_rejected_and_same_name_is_not_duplicated() -> None:
    db = _db()
    try:
        create_skill(db, title="  ", body="Текст", role="ks", author="Иванов")
        raise AssertionError("пустое название должно быть ошибкой")
    except SkillError as exc:
        assert "название" in str(exc)
    first = create_skill(db, title="Анализ комплекта", body="Первый текст", role="ks", author="Иванов")
    again = create_skill(db, title="  анализ   комплекта ", body="Другой текст", role="ks", author="Петров")
    assert again.id == first.id
    assert len(list_skills(db, "ks")) == 1
