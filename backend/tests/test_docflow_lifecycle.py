"""Граф жизненного цикла не даёт перескочить статус и не закрывает поручение исполнителем."""

from __future__ import annotations

import pytest

from app.services.docflow_lifecycle import (
    CLASSES,
    TransitionDenied,
    assert_transition,
    class_by_code,
)


def test_twelve_classes_and_info_has_no_execution_status() -> None:
    assert len(CLASSES) == 12
    info = class_by_code("info")
    assert info.execution is False
    assert [item.code for item in info.statuses] == ["received", "created", "delivered", "filed"]
    assert "done" not in {item.code for item in info.statuses}
    engineering = class_by_code("engineering")
    assert "filed" not in {item.code for item in engineering.statuses}


def test_incoming_cannot_jump_to_archive() -> None:
    with pytest.raises(TransitionDenied):
        assert_transition(
            "incoming",
            "received",
            "archive",
            actor_is_author=True,
            reason="",
        )
    assert_transition("incoming", "received", "registered", actor_is_author=False, reason="")


def test_memo_may_skip_optional_review_but_not_the_addressee() -> None:
    assert_transition("memo", "draft", "at_addressee", actor_is_author=True, reason="")
    with pytest.raises(TransitionDenied):
        assert_transition("memo", "draft", "filed", actor_is_author=True, reason="")
    with pytest.raises(TransitionDenied):
        assert_transition("memo", "at_addressee", "refusal", actor_is_author=True, reason="  ")


def test_only_the_author_closes_an_assignment() -> None:
    with pytest.raises(TransitionDenied, match="автор"):
        assert_transition(
            "assignment",
            "presented",
            "closed",
            actor_is_author=False,
            reason="",
        )
    assert_transition("assignment", "presented", "closed", actor_is_author=True, reason="")
    with pytest.raises(TransitionDenied, match="причина"):
        assert_transition(
            "assignment",
            "executing",
            "registered",
            actor_is_author=False,
            reason="",
        )


def test_contract_graph_exists_but_is_not_a_pilot() -> None:
    contract = class_by_code("contract")
    assert contract.pilot is False
    assert_transition("contract", "active", "terminated", actor_is_author=True, reason="срок")
