from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
PYBRIDGE = ROOT / "orchestrator" / "desktop-electron" / "pybridge"
if str(PYBRIDGE) in sys.path:
    sys.path.remove(str(PYBRIDGE))
sys.path.insert(0, str(PYBRIDGE))

from agent_sidecar import (  # noqa: E402
    OrderStream,
    Sidecar,
    _finish_order_survey,
    _journal_agent_messages,
    _order_case_read,
    _order_workspace_note,
    _order_restart_after_reply,
    _order_sentence_visible,
    _tool_specs_for_workflow,
    _order_memory_from_runs,
    _order_reread_tool,
    _order_reply_ready,
    _readable_order_answer,
    _order_restart_after_reply,
    _order_turn_answer,
    _space_order_text,
    _run_answer_done,
    _strip_run_chrome,
    _turn_answer_done,
    _with_order_brief,
)
from app.api_client import ApiError, _parse_agent_run  # noqa: E402
from app.sdk_agent.prompt import (  # noqa: E402
    build_order_continue_prompt,
    build_order_followup_prompt,
    build_sdk_prompt,
)


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
    plan = "Сводка короткая, дочитываю карточку, чтобы назвать пустое поле по делу."
    assert _turn_answer_done(plan, hide_tests=True) is False
    assert not _order_sentence_visible(plan, set())
    assert not _order_sentence_visible("Дочитываю регламент службы и полную карточку дела.", set())
    assert _turn_answer_done(answer, hide_tests=False) is False


def test_order_agent_does_not_open_workspace_notes() -> None:
    assert _order_workspace_note("office.read_file", {"filename": "materials/agent.md"})
    assert _order_workspace_note("office.read_file", {"path": r"materials\AGENTS.md"})
    assert _order_workspace_note("office.read_file", {"filename": "materials/manifest.json"})
    journal = "materials/run_journal/a74ab97b-5965-4de1-ae38-79977f6d2c67.md"
    assert _order_workspace_note("office.read_file", {"filename": journal})
    result = "tool_results/external_order.case_8b27b653-2e4.json"
    assert _order_workspace_note("office.read_file", {"filename": result})
    assert not _order_workspace_note("office.read_file", {"filename": "ТКП НП00-004275.pdf"})
    assert not _order_workspace_note("external_order.case", {"filename": "materials/agent.md", "action": "read"})


def test_case_scenario_starts_with_its_own_calculation() -> None:
    task = "Сценарий дела: Что блокирует (scenario=blockers)\n\nЧто блокирует переход."
    prompt = build_sdk_prompt(SimpleNamespace(title="ИИ-агент внешнего заказа · КС"), task)
    follow = build_order_followup_prompt(task, prior="Сотрудник: какая цена?\nПомощник: Цены в деле нет.")
    for text in (prompt, follow):
        assert "external_order.case" not in text
        assert "action=" not in text
        assert "auto_prepare" not in text
        assert "office.read_file" not in text
        assert "не факт" in text
        assert "Принять" in text
        assert "Не сливай слова" in text
    assert "Цены в деле нет" in follow
    assert "Что блокирует" in prompt
    plain = build_order_followup_prompt("оставь поле пустым")
    assert "Инструменты не вызывай" not in plain
    assert "empty=true" not in plain
    assert "Принять" in plain
    calc = build_order_followup_prompt(
        "помоги с расчётом",
        prior="Черновик: служебная записка по ВЗ-0026.",
        opening="Что уже есть по службе, какой черновик подготовить и что осталось пустым.",
    )
    assert "помоги с расчётом" in calc
    assert "не на заготовленный сценарий" in calc
    assert "В ответе: что уже есть" not in calc
    assert "external_order.case" not in calc
    promise = (
        "Продолжаю заказ ВЗ-0026 по службе «Производство» на этапе «Расчёт»: "
        "сначала сверюсь с карточкой и подготовлю черновик."
    )
    assert _turn_answer_done(promise, hide_tests=True) is False
    assert not _order_sentence_visible(promise, set())


def test_stream_chunks_keep_spaces_and_lines() -> None:
    stream = OrderStream()
    shown = [
        stream.take(chunk)
        for chunk in ["По", " службе", " ОМТО", " на этапе", " «Расчёт» уже есть путь 1С.", " Срок", " поставки 60 дн."]
    ]
    shown.append(stream.take("", flush=True))
    text = "\n\n".join(part for part in shown if part)
    assert "По службе ОМТО на этапе «Расчёт» уже есть путь 1С." in text
    assert "Срок поставки 60 дн." in text
    assert "Послужбе" not in text
    assert "\n\nслужбе" not in text


def test_syllable_lines_are_not_a_result() -> None:
    chunks = ["С\n", "начала\n", "сни\n", "му\n", " схему\n", " дела\n", " и\n", " подготов\n", "лю\n", " кар\n", "точку."]
    stream = OrderStream()
    shown = [stream.take(chunk) for chunk in chunks]
    shown.append(stream.take("", flush=True))
    assert not "".join(shown).strip()
    assert _readable_order_answer("\n\n".join(chunk.strip() for chunk in chunks)) == ""
    spaced = _space_order_text("ПослужбеОМТОвпути1СуказанызаказчикИНФРАСТРУКТУРАТКОООО,изделие")
    assert "По службе ОМТО в пути" in spaced
    assert "заказчик ИНФРАСТРУКТУРА ТК ООО" in spaced
    assert "изделие" in spaced


def test_stream_drops_the_turn_plan() -> None:
    stream = OrderStream()
    assert stream.take("Сначала сниму схему вызова, затем подготовлю дело.\n") == ""
    assert not _order_sentence_visible("Сначаласнимусхемуделаиподготовлюкарточку ОМТО по заказу.", set())
    assert not _order_sentence_visible("Снимаю схему дела и готовлю карточку ОМТО по заказу.", set())


def test_successful_case_read_ends_with_summary_and_questions(tmp_path: Path) -> None:
    summary = "Заказ ВЗ-0017 (заказчик, изделие). " + ("Стадия «ТКП выпущено». " * 40)
    assert len(summary) > 500
    questions = [
        {"id": "q1", "prompt": "Какой срок поставки?"},
        {"id": "q2", "prompt": "Кто конечный заказчик?"},
        {"prompt": "Нужен ли шефмонтаж?"},
    ]
    full = {"summary": summary, "questions": questions, "documents": [], "diffs": [{}] * 35}
    target = tmp_path / "tool_results" / "external_order.case_abc.json"
    target.parent.mkdir()
    target.write_text(json.dumps(full, ensure_ascii=False), encoding="utf-8")
    payload = {
        "type": "tool_result",
        "tool": "external_order.case",
        "ok": True,
        "result": {
            "externalized": True,
            "result_file": "tool_results/external_order.case_abc.json",
            "summary": {"summary": summary[:500], "questions": ["Какой срок поставки?"]},
        },
    }
    reply = _finish_order_survey(payload, "read_full", cwd=str(tmp_path))
    assert "ВЗ-0017" in reply
    assert "Какой срок поставки?" in reply
    assert "Кто конечный заказчик?" not in reply
    assert "Нужен ли шефмонтаж?" not in reply
    assert "Вопросы:" not in reply
    assert reply.count("Стадия") == 1
    assert _finish_order_survey(payload, "propose", cwd=str(tmp_path)) == ""
    assert _finish_order_survey(payload, "scenario", cwd=str(tmp_path)) == ""
    failed = {
        "type": "tool_result",
        "tool": "external_order.case",
        "ok": False,
        "error": "нет связи",
        "result": {"summary": summary},
    }
    assert _finish_order_survey(failed, "read", cwd=str(tmp_path)) == ""
    direct = {"type": "tool_result", "ok": True, "result": {"summary": "Короткая сводка дела.", "questions": []}}
    assert _finish_order_survey(direct, "auto_prepare", cwd=str(tmp_path)) == "Короткая сводка дела."


def test_case_result_stops_before_repository_reads(tmp_path: Path) -> None:
    summary = "Заказ ВЗ-0017. Стадия «ТКП». Путь в деле уже есть."
    target = tmp_path / "case.json"
    target.write_text(
        json.dumps(
            {
                "summary": summary,
                "questions": [{"prompt": "Какой срок поставки?"}],
                "documents": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    active = SimpleNamespace(
        hide_tests=True,
        stop=threading.Event(),
        answer_buf="Сначала посмотрю исходники sidecar.",
        order_stream=OrderStream(),
        case_reads=0,
        order_case_actions={},
        order_case_reply="",
        plan_writes=0,
        run_cwd=str(tmp_path),
        events=[],
        context=None,
        kind="run",
        workflow_id="",
        history_run_id="",
        event_workflow_id="",
        run_id="r1",
        gate=SimpleNamespace(mark_work_result_done=lambda: None),
        metrics=None,
    )
    on_event = Sidecar._forward_events(Sidecar.__new__(Sidecar), active, active.events)
    on_event(
        {
            "type": "tool_call",
            "tool": "external_order.case",
            "requestId": "case-1",
            "arguments": {"action": "read_full"},
        }
    )
    on_event(
        {
            "type": "tool_result",
            "tool": "external_order.case",
            "requestId": "case-1",
            "ok": True,
            "result": {"externalized": True, "result_file": "case.json", "summary": {"summary": "обрезано"}},
        }
    )
    assert not active.stop.is_set()
    assert active.order_case_reply == ""
    assert active.answer_buf == "Сначала посмотрю исходники sidecar."
    on_event(
        {
            "type": "tool_call",
            "tool": "external_order.case",
            "arguments": {"action": "plan"},
        }
    )
    assert not active.stop.is_set()
    on_event(
        {
            "type": "tool_call",
            "tool": "external_order.case",
            "arguments": {"action": "plan"},
        }
    )
    assert active.stop.is_set()
    assert active.plan_writes == 2


def test_second_case_read_in_a_turn_is_caught() -> None:
    call = {"tool": "external_order.case", "arguments": {"action": "auto_prepare"}}
    assert _order_case_read(call)
    assert not _order_case_read({"tool": "external_order.case", "arguments": {"action": "propose"}})
    assert not _order_case_read({"tool": "external_order.case", "arguments": {"action": "read_full"}})
    assert not _order_case_read({"tool": "external_order.case", "arguments": {"action": "scenario"}})
    prior = (
        "По службе ОМТО на этапе «Расчёт» заказа ВЗ-0026 уже есть путь 1С и опросный лист. "
        "Чек-лист этапа 5 из 5. Черновиков к принятию по службе 2. Пустое поле: заказ клиента. "
        "Заказчик ИНФРАСТРУКТУРА ТК ООО, ИНН 7734257891."
    )
    assert _order_restart_after_reply(prior, "Сначаласнимусхемуделаиподготовлюкарточку")


def test_order_prompt_leads_with_the_order_and_the_case_tool() -> None:
    task = "Заказ ВЗ-0026 (order_id=abc), заказчик Завод.\n\nВопроса нет."
    prompt = build_sdk_prompt(SimpleNamespace(title="ИИ-агент внешнего заказа · Коммерческая служба"), task)
    assert "order_id=abc" in prompt
    assert "action=auto_prepare" not in prompt
    assert "external_order.case" not in prompt
    assert "Не сливай слова" in prompt
    record = SimpleNamespace(
        id="wf-ks",
        title="ИИ-агент внешнего заказа · Коммерческая служба",
        notes="",
        local_run={"playbook": {"tools": ["users.current"], "steps": []}},
    )
    specs = _tool_specs_for_workflow(record) or []
    names = {str(item.get("name") or "") for item in specs}
    assert {"office.read_file", "onec.search_documents", "askQuestion", "excel.read_workbook"} <= names
    assert not names & {"workspace.powershell_run", "code.run_python", "msproject.build_plan"}
    case = next(item for item in specs if item.get("name") == "external_order.case")
    action = (case.get("inputSchema") or {}).get("properties", {}).get("action", {})
    assert "auto_prepare" in str(case.get("description") or "")
    assert "auto_prepare" in str(action.get("description") or "")
    assert "role" in (case.get("inputSchema") or {}).get("properties", {})
    repair = build_order_followup_prompt(
        "какая цена",
        prior="инструмента external_order.case на платформе нет, вызов auto_prepare не выполнен",
        opening="Заказ ВЗ-0026 (order_id=abc). role=ks.",
    )
    assert "order_id=abc" in repair
    assert "action=auto_prepare" not in repair
    assert "external_order.case" not in repair
    assert "Инструменты не вызывай" not in repair
    assert "Не сливай слова" in repair


def test_followup_prompt_does_not_restart_case() -> None:
    prompt = build_order_followup_prompt(
        "оставь поле пустым",
        prior="Санкции в деле не заполнены. Какой текст записать?",
    )
    assert "оставь поле пустым" in prompt
    assert "Санкции в деле не заполнены" in prompt
    assert "Инструменты не вызывай" not in prompt
    assert "eo-ai-1" in prompt
    assert "Не сливай слова" in prompt
    assert "empty=true" not in prompt
    assert "Принять" in prompt
    assert "WORK_RESULT" not in prompt


def test_conversation_memory_keeps_the_turns_in_order() -> None:
    runs = [
        SimpleNamespace(
            conversation_key="eo:1:legal:calc",
            message="оставь поле пустым",
            answer="Поле санкций оставлено пустым. Принять можно кнопкой «Принять».",
            status="ok",
        ),
        SimpleNamespace(
            conversation_key="eo:1:legal:calc",
            message="Какие санкции?",
            answer="В деле текста санкций нет.",
            status="ok",
        ),
    ]
    prior, reused = _order_memory_from_runs(runs, "eo:1:legal:calc", "оставь поле пустым")
    assert reused == ""
    assert prior.index("Сотрудник: Какие санкции?") < prior.index("Помощник: Поле санкций")
    assert "текста санкций нет" in prior
    assert _order_memory_from_runs(runs, "eo:2:legal:calc", "А какой срок?") == ("", "")


def test_journal_joins_token_fragments() -> None:
    lines = _journal_agent_messages(
        [
            {"type": "assistant", "text": "стой"},
            {"type": "assistant", "text": "кам"},
            {"type": "assistant", "text": "и"},
            {"type": "final", "text": "стойками"},
        ]
    )
    assert lines == ["стойками"]


def test_continue_prompt_does_not_reopen_the_case() -> None:
    prompt = build_order_continue_prompt()
    assert "Не пиши WORK_RESULT" in prompt
    assert "Не начинай сначала" in prompt
    assert "auto_prepare" not in prompt


def test_reread_after_answer_is_only_a_second_prepare() -> None:
    assert not _order_reread_tool({"tool": "Read", "arguments": {}})
    assert not _order_reread_tool({"tool": "external_order.case", "arguments": {"action": "read_full"}})
    assert _order_reread_tool({"tool": "external_order.case", "arguments": {"action": "auto_prepare"}})
    assert not _order_reread_tool({"tool": "external_order.case", "arguments": {"action": "propose"}})


def test_turn_answer_drops_the_launch_log() -> None:
    reply = (
        "По заказу ВЗ-0019 ТКП НП00-004243 выпущено, этап «ТКП». "
        "По коммерческой службе приняты черновики: цена 400530,00 руб. "
        "Пустое поле: НДС. Какая ставка НДС и входит ли она в цену?"
    )
    seen = (
        "Запускаю локальный Cursor SDK агент (grok-4.7 reasoning_effort=xhigh fast=true)... "
        "Инструменты Constructor: get_current_date, users.current, external_order.case, askQuestion "
        "Агент работает на этом компьютере... "
        "Сводка пришла урезанной, смотрю поля коммерческой службы. "
        + reply
    )
    assert "Запускаю локальный" not in _strip_run_chrome(seen)
    assert "Инструменты Constructor" not in _strip_run_chrome(seen)
    shown = _order_turn_answer(reply, seen)
    assert "Запускаю локальный" not in shown
    assert "Пустое поле: НДС." in shown
    assert "\n\n" in shown


def test_glued_russian_words_get_spaces() -> None:
    raw = (
        "Покоммерческойслужбевделеужеестьзаказ ВЗ-0026заказчика ИНФРАСТРУКТУРАТК ООО. "
        "Кпринятию 8черновиковпослужбе. Чек-лист этапа «Расчёт» закрыт: 5из 5."
    )
    shown = _space_order_text(raw)
    assert "По коммерческой службе в деле уже есть заказ" in shown
    assert "ИНФРАСТРУКТУРА ТК" in shown
    assert "К принятию" in shown
    assert "8 черновиков по службе" in shown
    assert "5 из 5" in shown
    assert "Нижегороднефтеоргсинтез" in _space_order_text("Нижегороднефтеоргсинтез")


def test_glued_service_reply_is_split_into_paragraphs() -> None:
    raw = (
        "По службе «Производство» уже есть состав UFG-F-050-Х5-C1TP, срок поставки30 дней и самовывоз. "
        "К принятию по службе2 черновика. Чек-лист этапа «Расчёт» —0/5. "
        "В пути1С нет нормативов. Какие нормативы действуют?"
    )
    shown = _order_turn_answer(raw, raw)
    assert "поставки 30" in shown
    assert "службе 2" in shown
    assert "— 0/5" in shown
    assert "пути 1С" in shown
    assert "Х5" in shown
    assert shown.count("\n\n") >= 3


def test_repeated_case_summary_is_shown_once() -> None:
    raw = (
        "Сначала сниму схему дела и подготовлю заказ одним вызовом. Вызываю подготовку дела по заказу ВЗ-0014. "
        "По службе ОМТО на этапе «Договор» по заказу ВЗ-0014 уже есть изделие ТКП НП00-004241, "
        "ИНН2312054894, сумма17800.00 руб., срок поставки2 дн., оплата17800.00 из17800.00. "
        "К принятию18 черновиков, по службе ОМТО1. "
        "Чек-лист этапа «Договор» —0 из8. В пути1С договора ещё нет. "
        "Подтвердите пункт чек-листа: «Закупки и критические позиции обеспечены». "
        "Сервер оборвал вызов, повторяю подготовку дела. "
        "По службе ОМТО в заказе ВЗ-0014 уже есть изделие ТКП НП00-004241, ИНН2312054894, сумма17800.00 руб. "
        "К принятию18 черновиков. Чек-лист этапа «Договор»:0 из8. "
        "Договор:Сначала сниму схему дела и подготовлю заказ одним вызовом."
    )
    shown = _order_turn_answer(raw, raw)
    folded = shown.casefold()
    assert "сначала сниму" not in folded
    assert "сервер оборвал" not in folded
    assert shown.count("НП00-004241") == 1
    assert "НП 00" not in shown
    assert "ВЗ-0014" in shown
    assert "ИНН 2312054894" in shown
    assert "сумма 17800" in shown
    assert "поставки 2" in shown
    assert "из 8" in shown
    assert "пути 1С" in shown
    assert "Подтвердите пункт" in shown
    assert "\n\n" in shown
    ready = (
        "По службе ОМТО уже есть ТКП НП00-004241. К принятию 18 черновиков. "
        "Чек-лист этапа договор 0 из 8. " + ("Подробность дела. " * 12)
    )
    assert _order_reply_ready(ready)
    assert _order_restart_after_reply(ready, "Сервер оборвал вызов, повторяю подготовку дела.")
    assert not _order_reply_ready("Сейчас прочитаю дело.")


def test_second_regulation_opening_stops_after_the_survey() -> None:
    survey = "Черновики записаны. " + ("Нужен ответ. " * 40) + "Какой срок поставки КИ?"
    assert _order_restart_after_reply(survey, "Сначала открою регламент агента и схему дела.")
    assert not _order_restart_after_reply("Сейчас прочитаю дело.", "Сначала открою регламент.")
