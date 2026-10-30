from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
PYBRIDGE = ROOT / "orchestrator" / "desktop-electron" / "pybridge"
if str(PYBRIDGE) in sys.path:
    sys.path.remove(str(PYBRIDGE))
sys.path.insert(0, str(PYBRIDGE))

from agent_sidecar import Sidecar, _run_answer_done, _turn_answer_done, _with_order_brief  # noqa: E402
from app.api_client import ApiError, _parse_agent_run  # noqa: E402
from app.sdk_agent.prompt import build_order_followup_prompt  # noqa: E402


class _Api:
    def __init__(self, runs: dict[str, list[SimpleNamespace]]) -> None:
        self.runs = runs
        self.asked: list[tuple[str, str]] = []

    def list_agent_runs(self, workflow_id: str, *, conversation_key: str = "") -> list[SimpleNamespace]:
        self.asked.append((workflow_id, conversation_key))
        return self.runs.get(conversation_key, [])


def _sidecar(api: object) -> Sidecar:
    sidecar = Sidecar.__new__(Sidecar)
    sidecar._api = api
    return sidecar


def _run(key: str, agent: str) -> SimpleNamespace:
    return SimpleNamespace(conversation_key=key, sdk_agent_id=agent)


def test_same_order_conversation_resumes_its_agent() -> None:
    key = "eo:order-19:it:collecting"
    api = _Api({key: [_run(key, ""), _run(key, "agent-19"), _run(key, "agent-old")]})
    assert _sidecar(api)._conversation_agent_id("wf-it", key) == "agent-19"
    assert api.asked == [("wf-it", key)]


def test_other_order_or_stage_starts_fresh() -> None:
    key = "eo:order-19:it:collecting"
    api = _Api({key: [_run(key, "agent-19")]})
    sidecar = _sidecar(api)
    assert sidecar._conversation_agent_id("wf-it", "eo:order-20:it:collecting") == ""
    assert sidecar._conversation_agent_id("wf-it", "eo:order-19:it:calculating") == ""
    assert sidecar._conversation_agent_id("wf-it", "") == ""


def test_foreign_rows_are_ignored() -> None:
    key = "eo:order-19:it:collecting"
    api = _Api({key: [_run("eo:order-20:it:collecting", "agent-20")]})
    assert _sidecar(api)._conversation_agent_id("wf-it", key) == ""


def test_server_error_means_fresh_conversation() -> None:
    class _Down:
        def list_agent_runs(self, *_a, **_k):
            raise ApiError("down")

    assert _sidecar(_Down())._conversation_agent_id("wf-it", "eo:o:it:s") == ""


def test_parse_agent_run_carries_conversation() -> None:
    item = _parse_agent_run(
        {"run_id": "r1", "conversation_key": "eo:o:it:s", "sdk_agent_id": "agent-1", "status": "ok"}
    )
    assert item.conversation_key == "eo:o:it:s"
    assert item.sdk_agent_id == "agent-1"


def test_order_turn_with_questions_is_finished() -> None:
    answer = "Черновики сохранены: срок и цена. Вопрос: кто конечный заказчик? В деле его нет."
    assert _run_answer_done(answer, hide_tests=True) is False
    assert _turn_answer_done(answer, hide_tests=True) is True
    assert _turn_answer_done("Сейчас прочитаю", hide_tests=True) is False
    assert _turn_answer_done(answer, hide_tests=False) is False


def test_followup_prompt_does_not_restart_case() -> None:
    prompt = build_order_followup_prompt("Конечный заказчик — АО Ромашка")
    assert "АО Ромашка" in prompt
    assert "не вызывай снова auto_prepare" in prompt
    assert "WORK_RESULT" not in prompt
