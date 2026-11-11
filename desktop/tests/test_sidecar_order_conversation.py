from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
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
    _survey_from_events,
    _journal_agent_messages,
    _order_case_read,
    _order_workspace_note,
    _order_restart_after_reply,
    _order_sentence_visible,
    _tool_specs_for_workflow,
    _order_memory_from_runs,
    _chat_files_notice,
    _order_folder_list,
    _order_guessed_file,
    _order_plan_fields,
    _order_turn_tools,
    _save_order_plan_file,
    _is_narration,
    _order_repeat_case,
    _order_report_saved,
    _order_reread_tool,
    _order_reply_ready,
    _readable_order_answer,
    _order_restart_after_reply,
    _order_turn_answer,
    _order_reply_or_card,
    _space_order_text,
    _run_answer_done,
    _strip_run_chrome,
    _turn_answer_done,
    _with_order_brief,
    _with_sidecar_prompt,
)
from app.api_client import ApiError, _parse_agent_run  # noqa: E402
from app.sdk_agent.prompt import (  # noqa: E402
    build_order_continue_prompt,
    build_order_followup_prompt,
    order_turn_prompt,
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


def test_order_break_keeps_card_instead_of_empty_failure() -> None:
    plan = "Сводка короткая, дочитываю карточку, чтобы назвать пустое поле по делу."
    events = [
        {
            "type": "tool_result",
            "tool": "external_order.case",
            "ok": True,
            "result": {
                "summary": "Черновики сохранены: срок. Вопрос: кто конечный заказчик?",
                "questions": ["Кто конечный заказчик?"],
                "stage": {"blocker": "нет конечного заказчика"},
                "role_label": "Производство",
            },
        }
    ]
    kept = _order_reply_or_card(plan, events, "")
    assert "без итога" not in kept
    assert "конечн" in kept.casefold()
    assert _order_reply_or_card(
        "Запуск завершился без итога — агент остановился после подготовительных шагов.",
        [],
        "",
    ).startswith("Реквизиты уже на карточке")


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
        for chunk in [
            "По", " службе", " ОМТО", " уже есть заказчик.",
            " Срок поставки 68 дней не сходится со сроком ТКП, поэтому цены надо подтвердить заново.",
        ]
    ]
    shown.append(stream.take("", flush=True))
    text = "\n\n".join(part for part in shown if part)
    assert "уже есть заказчик" not in text
    assert "не сходится" in text
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


def test_saved_report_ends_the_turn() -> None:
    active = SimpleNamespace(
        hide_tests=True,
        stop=threading.Event(),
        answer_buf="",
        order_stream=OrderStream(),
        case_reads=0,
        plan_writes=0,
        report_writes=0,
        order_case_actions={},
        order_case_reply="",
        run_cwd="",
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
    saved = {
        "type": "tool_result",
        "tool": "report.export_document",
        "requestId": "doc-1",
        "ok": True,
        "result": {"path": r"C:\agent\svodka.docx", "filename": "svodka.docx"},
    }
    assert _order_report_saved(saved)
    on_event(
        {
            "type": "tool_call",
            "tool": "report.export_document",
            "requestId": "doc-1",
            "arguments": {"filename": "svodka"},
        }
    )
    assert active.report_writes == 1
    assert not active.stop.is_set()
    on_event(saved)
    assert active.stop.is_set()
    on_event(
        {
            "type": "tool_call",
            "tool": "report.export_document",
            "requestId": "doc-2",
            "arguments": {"filename": "svodka-2"},
        }
    )
    assert active.report_writes == 1
    active.stop.clear()
    on_event(
        {
            "type": "tool_call",
            "tool": "report.export_document",
            "requestId": "doc-3",
            "arguments": {"filename": "svodka-3"},
        }
    )
    assert active.report_writes == 2
    assert active.stop.is_set()


def test_second_case_snapshot_is_not_a_new_read() -> None:
    assert not _order_repeat_case("read_full", "", "case-1")
    assert not _order_repeat_case("read_full", "case-1", "case-1")
    assert _order_repeat_case("read_full", "case-1", "case-2")
    assert _order_repeat_case("scenario", "case-1", "case-2")
    assert not _order_repeat_case("propose", "case-1", "case-2")
    assert _order_folder_list("excel.list_files")
    assert not _order_folder_list("excel.read_workbook")


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


def test_resumed_order_turn_sends_only_the_new_message() -> None:
    opening = "Сценарий дела: подготовь служебную записку по заказу ВЗ-0026."
    prior = "Сотрудник: подготовь записку\nПомощник: Черновик записки готов."
    resumed = order_turn_prompt("помоги с расчётом", resumed=True, prior=prior, opening=opening)
    fresh = order_turn_prompt("помоги с расчётом", resumed=False, prior=prior, opening=opening)
    assert "помоги с расчётом" in resumed
    assert "Сценарий дела" not in resumed
    assert "Черновик записки" not in resumed
    assert "Сценарий дела" in fresh
    assert "Черновик записки" in fresh


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
    assert "поставки 30" not in shown
    assert "Х5" not in shown
    assert "пути 1С" in shown
    assert "Какие нормативы действуют?" in shown


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
    assert "НП00-004241" not in shown
    assert "ИНН" not in shown
    assert "Подтвердите пункт" not in shown
    assert "договора ещё нет" in shown
    assert shown.count("договора") == 1
    ready = (
        "По службе ОМТО уже есть ТКП НП00-004241. К принятию 18 черновиков. "
        "Чек-лист этапа договор 0 из 8. " + ("Подробность дела. " * 12)
    )
    assert _order_reply_ready(ready)
    assert _order_restart_after_reply(ready, "Сервер оборвал вызов, повторяю подготовку дела.")
    assert not _order_reply_ready("Сейчас прочитаю дело.")


def test_helper_file_is_attached_as_soon_as_it_is_written(tmp_path: Path) -> None:
    book = tmp_path / "Последние_10_внешних_заказов.xlsx"
    book.write_bytes(b"PK\x03\x04")
    stale = tmp_path / "старый.xlsx"
    stale.write_bytes(b"PK\x03\x04")
    os.utime(stale, (time.time() - 3600, time.time() - 3600))
    active = SimpleNamespace(
        run_id="run-1",
        workflow_id="personal-agent:tester",
        event_workflow_id="",
        run_cwd=str(tmp_path),
        chat_started_at=time.time() - 30,
        chat_files_sent=(),
        chat_files_checked=0.0,
    )
    notice = _chat_files_notice(active, force=True)
    assert notice is not None
    assert [item["name"] for item in notice["files"]] == ["Последние_10_внешних_заказов.xlsx"]
    assert _chat_files_notice(active, force=True) is None
    other = SimpleNamespace(
        run_id="run-2",
        workflow_id="order-service",
        event_workflow_id="",
        run_cwd=str(tmp_path),
        chat_started_at=time.time() - 30,
        chat_files_sent=(),
        chat_files_checked=0.0,
    )
    assert _chat_files_notice(other, force=True) is None
    order = SimpleNamespace(
        run_id="run-3",
        workflow_id="5e407586-6b8b-4787-9a1b-8f90068bd61d",
        event_workflow_id="",
        run_cwd=str(tmp_path),
        chat_started_at=time.time() - 30,
        chat_files_sent=(),
        chat_files_checked=0.0,
        hide_tests=True,
    )
    order_notice = _chat_files_notice(order, force=True)
    assert order_notice is not None
    assert [item["name"] for item in order_notice["files"]] == ["Последние_10_внешних_заказов.xlsx"]


def test_order_prompt_does_not_send_the_agent_to_invent_files() -> None:
    prompt = build_sdk_prompt(
        SimpleNamespace(title="ИИ-агент внешних закупок", notes="", local_run={}),
        "Заказ ВЗ-0009 (order_id=abc), служба ОМТО, этап Расчёт.",
    )
    wrapped = _with_sidecar_prompt(prompt)
    assert "materials/attachments are per-run" not in wrapped
    assert "guessed path" in wrapped
    assert "eo-ai-1" in wrapped
    assert "action=plan" in wrapped
    assert "read_full" not in wrapped
    assert "do not hunt" in wrapped.casefold()
    plain = _with_sidecar_prompt("Sdelai demo")
    assert "materials/attachments are per-run" in plain
    follow = _with_sidecar_prompt(build_order_followup_prompt("какая цена"))
    assert "materials/attachments are per-run" not in follow
    assert "read_full" not in follow
    assert "do not restate" in follow.casefold()
    resumed = _with_sidecar_prompt(
        order_turn_prompt("какая цена", resumed=True, prior="Помощник: Срок поставки 35 дн.")
    )
    assert "35 дн" not in resumed
    assert "read_full" not in resumed


def test_guessed_case_files_are_not_opened(tmp_path: Path) -> None:
    cwd = str(tmp_path)
    missing = [
        ("office.read_file", "materials/attachments/desktop.ini"),
        ("office.read_file", "knowledge/eo-ai-1.md"),
        ("excel.read_workbook", "materials/B3-0009.xlsx"),
        ("excel.read_workbook", "materials/attachments.xlsx"),
        ("office.read_file", "materials/attachments/"),
        ("excel.read_workbook", "materials/attachments/002_kp.xlsx"),
        ("office.read_file", "materials/attachments/001_spec.pdf"),
        ("office.read_file", "materials/attachments/003_tz.docx"),
        ("office.read_file", "опросный_лист.docx"),
    ]
    for tool, filename in missing:
        assert _order_guessed_file(tool, {"filename": filename}, cwd)
    folder = tmp_path / "materials" / "attachments"
    folder.mkdir(parents=True)
    (folder / "002_kp.xlsx").write_bytes(b"PK")
    assert not _order_guessed_file(
        "excel.read_workbook",
        {"filename": "materials/attachments/002_kp.xlsx"},
        cwd,
    )
    assert not _order_guessed_file("external_order.case", {"action": "read_full"}, cwd)
    other = Path(tempfile.mkdtemp())
    outside = other / "elsewhere.txt"
    outside.write_text("x", encoding="utf-8")
    try:
        assert _order_guessed_file("office.read_file", {"filename": str(outside)}, cwd)
    finally:
        outside.unlink(missing_ok=True)
        other.rmdir()
    probe = tmp_path / "probe_text.md"
    probe.write_text("INCLUDETEXT", encoding="utf-8")
    assert _order_guessed_file("office.read_file", {"filename": "probe_text.md"}, cwd)
    assert _order_guessed_file("office.read_file", {"filename": str(probe)}, cwd)
    cache = Path(tempfile.gettempdir()) / "constructor-onec-artifacts"
    cache.mkdir(parents=True, exist_ok=True)
    saved = cache / "order-case-probe.docx"
    saved.write_bytes(b"PK")
    try:
        assert not _order_guessed_file("office.read_file", {"saved_path": str(saved)}, cwd)
    finally:
        saved.unlink(missing_ok=True)


def test_same_fact_is_not_said_three_times() -> None:
    text = (
        "Срок поставки: 35 дн. Доставка: самовывоз. "
        "Предложение станет фактом после кнопки «Принять». "
        "Срок поставки 35 дней, доставка самовывозом. "
        "Предложение станет фактом после кнопки «Принять». "
        "Черновик включается кнопкой «Принять», срок поставки те же 35 дн. "
        "Срок поставки критической позиции: 120 дн."
    )
    shown = _readable_order_answer(text)
    assert "срок поставки: 35" not in shown.lower()
    assert "самовывоз" not in shown.lower()
    assert "120" in shown


def test_gap_status_is_not_answered_in_the_chat() -> None:
    assert _is_narration("Вызов вернул, что дело уже открыто в этом ходе.")
    assert _is_narration("Ищу сводку, которая уже есть, без повторного чтения заказа.")
    assert _is_narration("Ищу снимок, который уже есть, чтобы не читать его повторно.")
    assert _is_narration("Карточка в этом ходе уже открыта.")
    assert not _order_sentence_visible("По расчёту ОМТО зафиксированных ответов на проверки службы нет.", set())
    assert not _order_sentence_visible(
        "Пока эти пункты пустые, у черновика расчёта нет ни цены, ни срока поставки.",
        set(),
    )
    assert not _order_sentence_visible("Нужно подтвердить, действуют ли исходные цены и обеспечены ли позиции.", set())
    assert _order_sentence_visible(
        "Срок действия ТКП в карточке уже раньше текущего дня, поэтому действие исходных цен нужно подтвердить отдельно.",
        set(),
    )
    assert _order_sentence_visible(
        "Пока состав и конструкторская документация не определены, к комитету заказ не проходит.",
        set(),
    )


def test_case_lookup_narration_stays_out_of_the_chat() -> None:
    assert _is_narration("Смотрю дело ВЗ-0009 по службе ОМТО на этапе «Расчёт».")
    assert _is_narration("Ищу готовые факты по заказу, чтобы не снимать его второй раз.")
    assert _is_narration("Дело уже открыто в этом ходе.")
    assert _is_narration("Файл не найден: materials/attachments/002_kp.xlsx.")
    assert not _is_narration("Срок поставки: 35 дн.")
    assert not _is_narration("Черновик вашей службы уже лежит в деле и фактом не является.")


def test_second_regulation_opening_stops_after_the_survey() -> None:
    survey = "Черновики записаны. " + ("Нужен ответ. " * 40) + "Какой срок поставки КИ?"
    assert _order_restart_after_reply(survey, "Сначала открою регламент агента и схему дела.")
    assert not _order_restart_after_reply("Сейчас прочитаю дело.", "Сначала открою регламент.")


def test_empty_separate_file_sentence_is_hidden() -> None:
    assert not _order_sentence_visible("Отдельный файл .", set())
    assert not _order_sentence_visible("Срок поставки: 35 дн.", set())
    assert _order_sentence_visible("Срок поставки критической позиции: 120 дн.", set())


def test_plan_file_is_copied_into_the_chat_folder(tmp_path: Path, monkeypatch) -> None:
    emitted: list[dict] = []
    monkeypatch.setattr("agent_sidecar.emit", emitted.append)

    class Api:
        def fetch_bytes(self, path: str) -> bytes:
            assert "bd1df3f7e5e943639b6dfb2d9fcd6980" in path
            assert "external-orders/" in path
            return b"<Project/>"

    payload = {
        "requestId": "req-1",
        "result": {
            "externalized": True,
            "result_file": "missing.json",
            "summary": {
                "summary": "План записан",
                "ok": True,
                "file_name": "План работ ВЗ-0026.xml",
                "document_id": "bd1df3f7e5e943639b6dfb2d9fcd6980",
            },
        },
    }
    assert _order_plan_fields(payload, str(tmp_path)) == (
        "План работ ВЗ-0026.xml",
        "bd1df3f7e5e943639b6dfb2d9fcd6980",
    )
    side = Sidecar.__new__(Sidecar)
    side._api = Api()
    active = SimpleNamespace(
        hide_tests=True,
        run_cwd=str(tmp_path),
        run_id="run-1",
        workflow_id="wf-1",
        event_workflow_id="",
        history_run_id="",
        order_case_actions={"req-1": "plan"},
        plan_orders={"req-1": "ВЗ-0026"},
        order_plan_files=(),
    )
    side._publish_order_plan(active, payload)
    saved = tmp_path / "План работ ВЗ-0026.xml"
    assert saved.read_bytes() == b"<Project/>"
    assert emitted[0]["type"] == "chat_files"
    assert emitted[0]["files"][0]["path"] == str(saved)
    assert _save_order_plan_file(Api(), str(tmp_path), "ВЗ-0026", "bd1df3f7e5e943639b6dfb2d9fcd6980", "../secret.xml") is None
    assert _save_order_plan_file(Api(), str(tmp_path), "../ВЗ", "not-an-id", "a.xml") is None
    assert not (tmp_path / "secret.xml").exists()


def test_order_turn_without_attachment_skips_office_and_excel() -> None:
    record = SimpleNamespace(
        id="wf-ks",
        title="ИИ-агент внешнего заказа · Коммерческая служба",
        notes="",
        local_run={"playbook": {"tools": ["users.current"], "steps": []}},
    )
    bare = {str(item.get("name") or "") for item in (_order_turn_tools(record, attached=False) or [])}
    assert "external_order.case" in bare
    assert "office.read_file" not in bare
    assert "excel.read_workbook" not in bare
    full = {str(item.get("name") or "") for item in (_order_turn_tools(record, attached=True) or [])}
    assert "office.read_file" in full


def test_plan_turn_keeps_mpp_next_to_xml(tmp_path: Path, monkeypatch) -> None:
    def fake_mpp(api: object, cwd: str, order_id: str, plan_args: dict, file_name: str) -> dict[str, str]:
        assert order_id == "ВЗ-0026"
        assert plan_args["start"] == "2026-11-02"
        assert file_name.endswith(".xml")
        path = Path(cwd) / "План работ ВЗ-0026.mpp"
        path.write_bytes(b"\xd0\xcf\x11\xe0mpp")
        return {"name": path.name, "path": str(path)}

    monkeypatch.setattr("agent_sidecar._save_order_mpp", fake_mpp)
    monkeypatch.setattr("agent_sidecar.emit", lambda message: None)

    class Api:
        def fetch_bytes(self, path: str) -> bytes:
            return b"<Project/>"

    side = Sidecar.__new__(Sidecar)
    side._api = Api()
    active = SimpleNamespace(
        hide_tests=True,
        run_cwd=str(tmp_path),
        run_id="run-1",
        workflow_id="wf-1",
        event_workflow_id="",
        history_run_id="",
        kind="run",
        answer_buf="Черновик уже назван.",
        order_case_actions={"req-1": "plan"},
        plan_orders={"req-1": "ВЗ-0026"},
        plan_args={"req-1": {"overrides": {}, "start": "2026-11-02"}},
        order_plan_files=(),
        stop=threading.Event(),
    )
    side._publish_order_plan(
        active,
        {
            "requestId": "req-1",
            "result": {
                "ok": True,
                "file_name": "План работ ВЗ-0026.xml",
                "document_id": "bd1df3f7e5e943639b6dfb2d9fcd6980",
                "summary": "План записан",
            },
        },
    )
    assert (tmp_path / "План работ ВЗ-0026.xml").read_bytes() == b"<Project/>"
    assert (tmp_path / "План работ ВЗ-0026.mpp").read_bytes().startswith(b"\xd0\xcf\x11\xe0")
    assert [item["name"] for item in active.order_plan_files] == [
        "План работ ВЗ-0026.xml",
        "План работ ВЗ-0026.mpp",
    ]
    assert active.stop.is_set()


def test_empty_model_answer_keeps_the_case_summary() -> None:
    events = [
        {
            "type": "tool_result",
            "tool": "external_order.case",
            "result": {"ok": True, "summary": "По карточке НП00-004332 заказ на расчёте.", "questions": []},
        }
    ]
    assert _survey_from_events(events) == "По карточке НП00-004332 заказ на расчёте."
