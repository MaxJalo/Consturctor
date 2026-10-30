from __future__ import annotations

import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.external_order import (
    ExternalOrder,
    ExternalOrderAudit,
    ExternalOrderBaseline,
    ExternalOrderCheck,
    ExternalOrderDecision,
    ExternalOrderDiff,
    ExternalOrderDocument,
    ExternalOrderFinding,
    ExternalOrderGap,
    ExternalOrderLine,
    ExternalOrderNotice,
    ExternalOrderRisk,
    ExternalOrderTask,
)
from app.services.external_order_matrix import evaluate_matrix, review_checklist
from app.services.external_order_strategy import link_strategy
from app.services.external_orders import (
    ExternalOrderError,
    accept_plan,
    add_baseline,
    add_decision,
    approve_order_file,
    close_conditions,
    close_gap,
    confirm_check,
    create_order,
    delete_order_file,
    import_onec_order,
    import_tkp_order,
    can_test_external_order,
    is_shared_external_order_agent,
    is_zhalybin,
    testing_profile,
    SIMPLIFIED_PATH,
    link_onec,
    make_plan,
    patch_order,
    propose,
    publish_order_plan,
    resolve_role,
    role_from_profile,
    transition,
    upload_order_file,
    read_case,
)


def _db():
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(
        bind=engine,
        tables=[
            ExternalOrder.__table__,
            ExternalOrderCheck.__table__,
            ExternalOrderDiff.__table__,
            ExternalOrderRisk.__table__,
            ExternalOrderDecision.__table__,
            ExternalOrderFinding.__table__,
            ExternalOrderDocument.__table__,
            ExternalOrderAudit.__table__,
            ExternalOrderGap.__table__,
            ExternalOrderBaseline.__table__,
            ExternalOrderTask.__table__,
            ExternalOrderLine.__table__,
            ExternalOrderNotice.__table__,
        ],
    )
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)()


def _create(db):
    return create_order(
        db,
        role="ks",
        fio="Ильченко Екатерина Александровна",
        fields={"customer": "Заказчик", "product": "Расходомер"},
    )


_BASELINE = {
    "composition": "насос",
    "cost": "100",
    "mcr": "80",
    "margin": "20",
    "bdds": "аванс 50",
    "deadlines": "120 дней",
}


def _baseline(db, order_id: str) -> str:
    body = add_baseline(db, order_id, role="finance", fio="Финансы", fields=_BASELINE)
    return body["baselines"][-1]["code"]


def test_final_tkp_blocked_without_committee_protocol():
    db = _db()
    order = _create(db)
    try:
        transition(db, order["id"], role="ks", fio="Ильченко", target="tkp_issued")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "протокола" in exc.detail
    else:
        raise AssertionError("ТКП выпустилось без протокола")


def test_tkp_after_committee_protocol():
    db = _db()
    order = _create(db)
    add_decision(
        db,
        order["id"],
        role="committee",
        fio="Секретарь",
        fields={"decision": "confirmed", "protocol": "ПР-1", "base_version": _baseline(db, order["id"])},
    )
    issued = transition(db, order["id"], role="ks", fio="Ильченко", target="tkp_issued")
    assert issued["status"] == "tkp_issued"


def test_ks_cannot_confirm_legal_checklist():
    db = _db()
    order = _create(db)
    legal = next(item for item in order["checks"] if item["owner_role"] == "legal")
    try:
        confirm_check(db, order["id"], legal["id"], role="ks", fio="Ильченко", evidence="согласовано")
    except ExternalOrderError as exc:
        assert exc.status == 403
        assert "чужой" in exc.detail
    else:
        raise AssertionError("КС подтвердила юридический пункт")


def test_onec_link_sets_payment_and_blocks_partial_close(monkeypatch):
    def fake_read(ref_key: str) -> dict:
        return {
            "order_key": ref_key,
            "order_number": "ЗК-1",
            "order_date": "2026-10-01",
            "amount": "1000.00",
            "paid": "250.00",
            "payment_percent": "25",
            "counterparty_key": "c1",
            "counterparty": "ООО Ромашка",
            "inn": "7700000000",
            "contract_key": "d1",
            "contract": "Д-1",
        }

    monkeypatch.setattr("app.services.external_order_onec.read_order", fake_read)
    monkeypatch.setattr("app.services.external_order_onec.tkp_key_for_order", lambda _key: "")
    db = _db()
    order = _create(db)
    linked = link_onec(db, order["id"], role="ks", fio="Ильченко", ref_key="11111111-1111-1111-1111-111111111111")
    assert linked["customer"] == "ООО Ромашка"
    assert linked["payment_percent"] == 25
    assert "ЗК-1" in linked["payment_note"]
    try:
        transition(db, order["id"], role="rp", fio="РП", target="closed")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "100%" in exc.detail
    else:
        raise AssertionError("частичная оплата из 1С закрыла заказ")


def test_rp_cannot_link_onec_order():
    db = _db()
    order = _create(db)
    try:
        link_onec(db, order["id"], role="rp", fio="РП", ref_key="11111111-1111-1111-1111-111111111111")
    except ExternalOrderError as exc:
        assert exc.status == 403
    else:
        raise AssertionError("РП привязал заказ 1С")


def test_close_blocked_without_full_payment():
    db = _db()
    order = _create(db)
    try:
        transition(db, order["id"], role="rp", fio="РП", target="closed")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "100%" in exc.detail
    else:
        raise AssertionError("заказ закрылся без оплаты")


def test_sign_blocked_by_open_difference():
    db = _db()
    order = _create(db)
    try:
        transition(db, order["id"], role="ks", fio="Ильченко", target="contract_signed")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "расхождение" in exc.detail
    else:
        raise AssertionError("договор подписан при открытом расхождении")


def test_rp_cannot_change_price():
    db = _db()
    order = _create(db)
    try:
        patch_order(
            db,
            order["id"],
            role="rp",
            fio="РП",
            fields={"sections": {"commercial": {"price": "100"}}},
        )
    except ExternalOrderError as exc:
        assert exc.status == 403
        assert "цену" in exc.detail
    else:
        raise AssertionError("РП изменил цену")


def test_only_zhalybin_can_switch_role():
    assert is_zhalybin("Жалыбин Максим Дмитриевич")
    assert not is_zhalybin("Жалыбин Пётр Иванович")
    assert can_test_external_order("Рамазанов Роман")
    assert can_test_external_order("Рамазанов Роман Иванович")
    assert not can_test_external_order("Рамазанов Пётр")
    switched = resolve_role(
        fio="Жалыбин Максим Дмитриевич",
        position="Инженер",
        department="",
        as_role="committee",
    )
    assert switched == "committee"
    ramazanov = resolve_role(
        fio="Рамазанов Роман",
        position="Инженер",
        department="",
        as_role="committee",
    )
    assert ramazanov == "committee"
    tester = resolve_role(
        fio="Рамазанов Роман Джалилович",
        position="Инженер-тестировщик 1 категории",
        department="Сектор качества разработки",
        as_role="",
    )
    assert tester == "it"
    assert role_from_profile("Инженер-тестировщик 1 категории", "Сектор качества разработки") == "viewer"
    assert role_from_profile("Мастер", "Производство качество и сервис") == "production"
    stored = testing_profile(
        fio="",
        position="",
        department="",
        stored_fio="Рамазанов Роман Джалилович",
        stored_position="Инженер-тестировщик 1 категории",
        stored_department="Сектор качества разработки",
    )
    assert stored[0] == "Рамазанов Роман Джалилович"
    assert can_test_external_order(*stored)
    assert is_shared_external_order_agent("ИИ-агент внешнего заказа · ИТ и администраторы")
    assert is_shared_external_order_agent("ИИ-агент внешних закупок")
    assert not is_shared_external_order_agent("ИИ-агент поручений")


def test_simplified_path_keeps_nonserial_links():
    forms = {item["id"]: item["form"] for item in SIMPLIFIED_PATH}
    files = {item["id"]: item["file"] for item in SIMPLIFIED_PATH}
    assert forms["zpr"].endswith("ТД_ЗаявкаОПотребностиРынка.Форма.ФормаСписка")
    assert forms["passport"].endswith("ТД_ЖурналКартЗаказа.Форма.ФормаСписка")
    assert forms["contract"].endswith("ЗаказКлиента.Форма.ФормаСпискаДокументов")
    assert forms["linked"] == forms["contract"]
    assert forms["start"].endswith("ТД_РаспоряжениеОНачалеПроекта.ФормаСписка")
    assert forms["plan"].endswith("CRM_ФормаСписка")
    assert files["plan"].endswith("Шаблон плана без РУКОВОДСТВА.mpp")
    assert forms["committee"] == ""
    assert "реализуемость" in next(item["prompt"] for item in SIMPLIFIED_PATH if item["id"] == "tech")
    assert "условия договора" in next(item["prompt"] for item in SIMPLIFIED_PATH if item["id"] == "plan")


def test_purchase_agent_prompt_stays_a_draft():
    from app.services.external_purchase_agent import GOAL, INSTRUCTIONS, TITLE

    assert TITLE == "ИИ-агент внешних закупок"
    assert "закупк" in INSTRUCTIONS.casefold()
    assert "не утверждаешь цену" in INSTRUCTIONS
    assert "omto" in INSTRUCTIONS
    assert "закупк" in GOAL.casefold()
    assert "Черновик не называй фактом" in INSTRUCTIONS
    ignored = resolve_role(
        fio="Ильченко Екатерина Александровна",
        position="Помощник Председателя совета директоров",
        department="",
        as_role="committee",
    )
    assert ignored != "committee"


def test_each_service_has_an_active_agent():
    from app.services.external_orders import ROLES
    from app.services.external_service_agents import SERVICE_FOCUS, playbook, service_roles, stamp_active

    roles = service_roles()
    assert "viewer" not in roles
    assert set(roles) == set(SERVICE_FOCUS)
    assert set(roles) == {role for role in ROLES if role != "viewer"}
    titles = []
    for role in roles:
        book = playbook(role)
        titles.append(book["name"])
        assert role in book["instructions"]
        assert "Черновик не называй фактом" in book["instructions"]
        assert "не переводишь стадию" in book["instructions"]
        assert "Дальнейший путь" in book["instructions"]
        if role == "production":
            assert "action=plan" in book["instructions"]
            assert "предмет, состав, количество, цена, НДС" in book["instructions"]
            assert "уже не относится" not in book["instructions"]
            assert "action=plan" in book["steps"][0]["action"]
        local = {"paused": True, "status": "inactive"}
        stamp_active(local, role)
        assert "paused" not in local
        assert local["status"] == "active"
        assert local["published"] is True
    assert len(titles) == len(set(titles))


def _docx(paragraphs: list[str]) -> str:
    import base64
    import io
    import zipfile

    body = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in paragraphs)
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as package:
        package.writestr("word/document.xml", xml)
    return base64.b64encode(buffer.getvalue()).decode()


def test_ready_for_committee_blocked_by_open_check():
    db = _db()
    order = _create(db)
    try:
        transition(db, order["id"], role="development", fio="Развитие", target="ready_committee")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "Комитету" in exc.detail
    else:
        raise AssertionError("переход прошёл при открытом пункте")


def test_finding_without_location_becomes_gap():
    db = _db()
    order = _create(db)
    body = propose(
        db,
        order["id"],
        fio="агент",
        findings=[{"field": "price", "value": "100", "source_ref": "договор.docx", "owner_role": "finance"}],
        diffs=[],
    )
    assert body["findings"] == []
    assert any(item["field"] == "price" for item in body["gaps"])


def test_approved_file_cannot_be_deleted_and_duplicate_is_rejected():
    db = _db()
    order = _create(db)
    payload = {"kind": "contract", "filename": "dogovor.docx", "content_base64": _docx(["Цена 100 руб."])}
    saved = upload_order_file(db, order["id"], role="ks", fio="Ильченко", fields=payload)
    document = saved["documents"][0]
    assert any(item["location"].startswith("абзац") for item in saved["findings"])
    approved = approve_order_file(db, order["id"], document["id"], role="ks", fio="Ильченко")
    try:
        delete_order_file(db, order["id"], document["id"], role="ks", fio="Ильченко")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "Утвержд" in exc.detail
    else:
        raise AssertionError("утверждённый файл удалился")
    try:
        upload_order_file(db, order["id"], role="ks", fio="Ильченко", fields=payload)
    except ExternalOrderError as exc:
        assert exc.status == 409
    else:
        raise AssertionError("дубль файла принят")
    assert approved["documents"][0]["approved"] is True


def test_condition_without_owner_document_is_rejected():
    db = _db()
    order = _create(db)
    decided = add_decision(
        db,
        order["id"],
        role="committee",
        fio="Секретарь",
        fields={
            "decision": "confirmed_conditions",
            "protocol": "ПР-2",
            "base_version": _baseline(db, order["id"]),
            "conditions": "закрыть цену",
        },
    )
    decision_id = decided["decisions"][0]["id"]
    try:
        close_conditions(db, order["id"], decision_id, role="committee", fio="Секретарь", document_id="")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "владельца" in exc.detail
    else:
        raise AssertionError("условие закрылось без документа")
    uploaded = upload_order_file(
        db,
        order["id"],
        role="finance",
        fio="Финансы",
        fields={"kind": "condition", "filename": "zakl.docx", "content_base64": _docx(["Цена подтверждена"])},
    )
    document_id = next(item["id"] for item in uploaded["documents"] if item["kind"] == "condition")
    closed = close_conditions(
        db, order["id"], decision_id, role="committee", fio="Секретарь", document_id=document_id
    )
    assert closed["decisions"][0]["conditions_closed"] is True


def test_new_baseline_after_protocol_needs_reason_and_plan_is_not_copied():
    db = _db()
    order = _create(db)
    fields = {
        "composition": "насос",
        "cost": "100",
        "mcr": "80",
        "margin": "20",
        "bdds": "аванс 50",
        "deadlines": "120 дней",
    }
    first = add_baseline(db, order["id"], role="finance", fio="Финансы", fields=fields)
    baseline_id = first["baselines"][0]["id"]
    add_decision(
        db,
        order["id"],
        role="committee",
        fio="Секретарь",
        fields={"decision": "confirmed", "protocol": "ПР-3", "baseline_id": baseline_id},
    )
    try:
        add_baseline(db, order["id"], role="finance", fio="Финансы", fields=fields)
    except ExternalOrderError as exc:
        assert exc.status == 400
        assert "основан" in exc.detail
    else:
        raise AssertionError("версия без основания принята")
    planned = make_plan(db, order["id"], role="rp", fio="РП")
    count = len(planned["tasks"])
    again = make_plan(db, order["id"], role="rp", fio="РП")
    assert len(again["tasks"]) == count
    accept_plan(db, order["id"], role="rp", fio="РП")
    publish_order_plan(db, order["id"], role="rp", fio="РП")
    try:
        publish_order_plan(db, order["id"], role="rp", fio="РП")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "копи" in exc.detail
    else:
        raise AssertionError("повторная публикация создала задачи")


def test_new_specification_after_decision_opens_repeat_conclusions():
    db = _db()
    order = _create(db)
    add_decision(
        db,
        order["id"],
        role="committee",
        fio="Секретарь",
        fields={"decision": "confirmed", "protocol": "ПР-4", "base_version": _baseline(db, order["id"])},
    )
    changed = upload_order_file(
        db,
        order["id"],
        role="ks",
        fio="Ильченко",
        fields={"kind": "specification", "filename": "spec.docx", "content_base64": _docx(["Цена 200"])},
    )
    assert any(item["kind"] == "change" for item in changed["notices"])
    assert any(item["field"].startswith("повтор") for item in changed["gaps"])
    assert any(item["field"] == "новая базовая версия" for item in changed["gaps"])
    assert all(item["immutable"] for item in changed["baselines"])


def test_import_onec_puts_order_on_request_stage_once(monkeypatch):
    def fake_read(ref_key: str) -> dict:
        return {
            "order_key": ref_key,
            "order_number": "ЗК-9",
            "order_date": "2026-10-02",
            "amount": "500.00",
            "paid": "0.00",
            "payment_percent": "0",
            "counterparty_key": "c1",
            "counterparty": "ООО Ромашка",
            "inn": "7700000000",
            "contract_key": "",
            "contract": "",
        }

    monkeypatch.setattr("app.services.external_order_onec.read_order", fake_read)
    monkeypatch.setattr("app.services.external_order_onec.tkp_key_for_order", lambda _key: "")
    db = _db()
    key = "11111111-1111-1111-1111-111111111111"
    first = import_onec_order(db, role="it", fio="Жалыбин", ref_key=key)
    assert first["customer"] == "ООО Ромашка"
    assert first["stage_label"] == "Запрос"
    assert first["onec_number"] == "ЗК-9"
    second = import_onec_order(db, role="ks", fio="Ильченко", ref_key=key)
    assert second["id"] == first["id"]
    assert db.query(ExternalOrder).count() == 1


def test_import_tkp_reflects_path_and_does_not_duplicate(monkeypatch):
    def fake_trace(ref_key: str) -> dict:
        return {
            "tkp_key": ref_key,
            "tkp_number": "НП00-003564",
            "tkp_status": "Согласовано",
            "tkp_status_label": "Согласовано",
            "comment": "ГРС",
            "order_key": "aabb8097-84c3-11f1-9848-6cb31113810e",
            "order_number": "НП00-001686",
            "order_date": "2026-10-20",
            "order_status": "К обеспечению",
            "amount": "1.00",
            "paid": "0.00",
            "payment_percent": "0",
            "counterparty_key": "c1",
            "counterparty": "Заказчик пути",
            "inn": "0277014204",
            "contract_key": "d1",
            "contract": "Договор поставки",
            "contract_number": "МПГ00000000",
            "path": (
                '[{"id":"tkp","title":"ТКП","state":"done","detail":"НП00-003564 · Согласовано"},'
                '{"id":"shipment","title":"Отгрузка","state":"done","detail":"НП00-001686, Отгружено"},'
                '{"id":"payment","title":"Оплата","state":"current","detail":"0% по поступлениям заказа"}]'
            ),
            "suggested_stage": "payment",
            "suggested_status": "awaiting_payment",
        }

    monkeypatch.setattr("app.services.external_order_onec.trace_tkp", fake_trace)
    db = _db()
    key = "15496a03-7956-4a03-8e57-3192c20f1808"
    first = import_tkp_order(db, role="ks", fio="Ильченко", ref_key=key)
    assert first["customer"] == "Заказчик пути"
    assert first["stage"] == "payment"
    assert first["status"] == "awaiting_payment"
    assert "ТКП: НП00-003564" in first["path_label"]
    assert "Отгрузка: НП00-001686, Отгружено" in first["path_label"]
    second = import_tkp_order(db, role="it", fio="Жалыбин", ref_key=key)
    assert second["id"] == first["id"]
    assert db.query(ExternalOrder).count() == 1


def test_strategy_link_stores_turboproject_without_writing_tasks(monkeypatch):
    def fake_search(args):
        assert "Путь" in str(args.get("query") or "")
        return {
            "projects": [
                {
                    "file_id": "file-1",
                    "project_name": "ГРС Путь Ленина",
                    "owner": "РП",
                    "customer": "Заказчик",
                    "dates": {"start_date": "2026-09-01", "finish_date": "2026-12-01", "baseline_finish": "2026-11-15"},
                    "data_1c": {"nomer_proekta": "ПР-1", "status_proekta": "В работе"},
                }
            ]
        }

    monkeypatch.setattr("app.services.turboproject.search_projects", fake_search)
    db = _db()
    order = _create(db)
    row = db.get(ExternalOrder, order["id"])
    row.customer = "Заказчик"
    row.sections_json = '{"onec": {"deal_name": "Сделка / ГРС Путь Ленина", "order_number": "НП00-001000"}}'
    db.commit()
    linked = link_strategy(db, order["id"], role="rp", fio="РП")
    strategy = linked["sections"]["strategy"]
    assert strategy["file_id"] == "file-1"
    assert strategy["finish_date"] == "2026-12-01"
    assert "не записываются" in strategy["note"]


def test_matrix_marks_linked_turboproject_plan():
    matrix = evaluate_matrix(
        {
            "code": "ВЗ-0001",
            "sections": {"strategy": {"file_id": "file-1", "project_name": "ГРС Путь Ленина"}},
            "checks": [],
            "diffs": [],
            "documents": [],
            "findings": [],
            "risks": [],
            "decisions": [],
            "baselines": [],
            "tasks": [],
            "lines": [],
            "notices": [],
            "gaps": [],
            "audit": [],
            "blocks": [],
        }
    )
    row = next(item for item in matrix["rows"] if item["id"] == "FR-013")
    assert row["state"] == "done"


def test_matrix_and_checklist_review_use_the_case():
    db = _db()
    order = _create(db)
    matrix = evaluate_matrix(order)
    by_id = {row["id"]: row for row in matrix["rows"]}
    assert len(matrix["rows"]) == 50
    assert by_id["FR-001"]["state"] == "done"
    assert by_id["FR-013"]["state"] in {"out", "wait"}
    assert by_id["FR-009"]["state"] == "gap"
    review = review_checklist(order)
    assert any(item["verdict"] == "wait" for item in review["checks"])
    assert any(item["code"] == "B05" and item["verdict"] == "gap" for item in review["diffs"])
    assert "B05" in review["prompt"]


def test_rp_cannot_import_onec_order():
    db = _db()
    try:
        import_onec_order(db, role="rp", fio="РП", ref_key="11111111-1111-1111-1111-111111111111")
    except ExternalOrderError as exc:
        assert exc.status == 403
    else:
        raise AssertionError("РП загрузил заказ из 1С")


def _xlsx(rows: list[list[str]]) -> str:
    import base64
    import io
    import zipfile

    body = "".join(
        f'<row r="{index}">' + "".join(f"<c><v>{value}</v></c>" for value in row) + "</row>"
        for index, row in enumerate(rows, start=1)
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{body}</sheetData></worksheet>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as package:
        package.writestr("xl/worksheets/sheet1.xml", xml)
    return base64.b64encode(buffer.getvalue()).decode()


def _upload(db, order_id: str, kind: str, name: str, content: str, role: str = "ks") -> dict:
    return upload_order_file(
        db, order_id, role=role, fio="Участник", fields={"kind": kind, "filename": name, "content_base64": content}
    )


def test_found_field_closes_gap_and_owner_closes_the_rest(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.external_order_case.BACKEND_ROOT", tmp_path)
    db = _db()
    order = _create(db)
    first = _upload(db, order["id"], "contract", "d1.docx", _docx(["Цена 100 руб."]))
    warranty = [item for item in first["gaps"] if item["field"] == "warranty" and item["status"] == "open"]
    assert len(warranty) == 1
    again = _upload(db, order["id"], "contract", "d2.docx", _docx(["Цена 100 руб.", "Срок 10 дней"]))
    assert len([item for item in again["gaps"] if item["field"] == "warranty" and item["status"] == "open"]) == 1
    found = _upload(db, order["id"], "contract", "d3.docx", _docx(["Гарантия 24 месяца"]))
    assert not [item for item in found["gaps"] if item["field"] == "warranty" and item["status"] == "open"]
    sanctions = next(item for item in found["gaps"] if item["field"] == "sanctions" and item["status"] == "open")
    for role, note, status in (("ks", "есть", 403), ("legal", "", 400)):
        try:
            close_gap(db, order["id"], sanctions["id"], role=role, fio="Кто-то", note=note)
        except ExternalOrderError as exc:
            assert exc.status == status
        else:
            raise AssertionError("пробел закрыт без владельца или ответа")
    closed = close_gap(db, order["id"], sanctions["id"], role="legal", fio="Юрист", note="санкций нет, письмо заказчика")
    assert next(item for item in closed["gaps"] if item["id"] == sanctions["id"])["status"] == "closed"


def test_specification_compares_with_latest_version_and_delete_cleans_up(monkeypatch, tmp_path):
    from app.models.external_order import ExternalOrderFinding, ExternalOrderLine

    monkeypatch.setattr("app.services.external_order_case.BACKEND_ROOT", tmp_path)
    db = _db()
    order = _create(db)
    _upload(db, order["id"], "specification", "s1.xlsx", _xlsx([["Насос", "1", "100"], ["Датчик", "1", "10"]]), "kb")
    _upload(db, order["id"], "specification", "s2.xlsx", _xlsx([["Насос", "2", "200"]]), "kb")
    third = _upload(db, order["id"], "specification", "s3.xlsx", _xlsx([["Насос", "2", "200"], ["Кабель", "5", "5"]]), "kb")
    docs = {item["file_name"]: item["id"] for item in third["documents"]}
    db.expire_all()
    changes = {item.name: item.change for item in db.query(ExternalOrderLine).filter_by(document_id=docs["s3.xlsx"])}
    assert changes == {"Насос": "same", "Кабель": "added"}
    delete_order_file(db, order["id"], docs["s2.xlsx"], role="kb", fio="КБ")
    contract = _upload(db, order["id"], "contract", "d.docx", _docx(["Цена 100 руб."]))
    contract_id = next(item["id"] for item in contract["documents"] if item["kind"] == "contract")
    delete_order_file(db, order["id"], contract_id, role="ks", fio="КС")
    db.expire_all()
    assert db.query(ExternalOrderLine).filter_by(document_id=docs["s2.xlsx"]).count() == 0
    assert db.query(ExternalOrderFinding).filter_by(document_id=contract_id).count() == 0
    fourth = _upload(db, order["id"], "specification", "s4.xlsx", _xlsx([["Насос", "3", "300"]]), "kb")
    versions = [item["version"] for item in fourth["documents"] if item["kind"] == "specification"]
    assert sorted(versions) == ["v1", "v3", "v4"]


def test_status_cannot_skip_stages():
    db = _db()
    order = _create(db)
    try:
        transition(db, order["id"], role="ks", fio="Ильченко", target="contract_review")
    except ExternalOrderError as exc:
        assert exc.status == 409
        assert "Сначала" in exc.detail
    else:
        raise AssertionError("черновик ушёл на согласование договора")
    moved = transition(db, order["id"], role="ks", fio="Ильченко", target="collecting")
    assert moved["status"] == "collecting"
    assert any(
        item["action"] == "transition" and item["before_value"] == "Черновик запроса" for item in moved["audit"]
    )


def test_committee_locks_only_a_filled_baseline():
    db = _db()
    order = _create(db)
    try:
        add_decision(
            db, order["id"], role="committee", fio="Секретарь",
            fields={"decision": "confirmed", "protocol": "ПР-5", "base_version": "БВ-1"},
        )
    except ExternalOrderError as exc:
        assert exc.status == 400
        assert "не найдена" in exc.detail
    else:
        raise AssertionError("Комитет зафиксировал несуществующую базовую версию")
    code = _baseline(db, order["id"])
    decided = add_decision(
        db, order["id"], role="committee", fio="Секретарь",
        fields={"decision": "confirmed", "protocol": "ПР-5", "base_version": code.lower()},
    )
    assert decided["baselines"][0]["immutable"] is True
    assert decided["decisions"][0]["base_version"] == code


def test_sign_and_close_wait_for_checklists():
    db = _db()
    order = _create(db)
    row = db.get(ExternalOrder, order["id"])
    for diff in row.diffs:
        diff.status = "closed"
    row.status = "contract_review"
    db.commit()
    try:
        transition(db, order["id"], role="ks", fio="Ильченко", target="contract_signed")
    except ExternalOrderError as exc:
        assert "согласования" in exc.detail
    else:
        raise AssertionError("договор подписан без согласований")
    row.payment_percent = 100
    row.status = "awaiting_payment"
    db.commit()
    try:
        transition(db, order["id"], role="rp", fio="РП", target="closed")
    except ExternalOrderError as exc:
        assert "Закрытие заблокировано" in exc.detail
    else:
        raise AssertionError("заказ закрыт с открытыми обязательствами")


def test_acceptance_opens_without_act_but_shipping_needs_it():
    db = _db()
    order = _create(db)
    row = db.get(ExternalOrder, order["id"])
    row.status = "production"
    for item in row.checks:
        if item.gate == "before_ship":
            item.status = "done"
    db.commit()
    accepted = transition(db, order["id"], role="rp", fio="РП", target="acceptance")
    assert accepted["blocks"] == ["Отгрузка заблокирована: нет приёмочных документов"]
    try:
        transition(db, order["id"], role="rp", fio="РП", target="shipped")
    except ExternalOrderError as exc:
        assert "приёмочных" in exc.detail
    else:
        raise AssertionError("отгрузка без приёмочного акта")


def test_agent_case_read_fits_in_the_tool_result():
    db = _db()
    created = _create(db)
    body = read_case(db, created["id"])
    raw = json.dumps(body, ensure_ascii=False)
    assert len(raw.encode("utf-8")) < 6000
    assert "audit" not in body
    assert "diffs" not in body
    assert "Расходомер" in body["summary"]
    assert "ТКП выпущено" not in body["summary"]
    assert "result_file не открывай" in body["agent_limits"]


def test_production_plan_puts_contract_conditions_in_the_file(tmp_path, monkeypatch):
    from pathlib import Path

    from app.models.external_order import ExternalOrderFinding
    from app.services.external_order_plan import build_work_plan

    monkeypatch.setattr("app.services.external_order_plan.BACKEND_ROOT", tmp_path)
    db = _db()
    created = _create(db)
    row = db.get(ExternalOrder, created["id"])
    row.sections_json = json.dumps(
        {"onec": {"contract_number": "МПГ00013812"}, "commercial": {"price": "1000"}},
        ensure_ascii=False,
    )
    db.add(
        ExternalOrderFinding(
            id="finding-subject",
            order_id=row.id,
            field="subject",
            value="насос",
            source_ref="договор",
            location="абзац 2",
            status="accepted",
            owner_role="ks",
            proposed_by="тест",
        )
    )
    db.commit()
    result = build_work_plan(db, created["id"], fio="Производство")
    assert result["file_name"].endswith(".xml")
    assert "Цена" not in result["missing"]
    assert "НДС" in result["missing"]
    db.refresh(row)
    docs = [item for item in row.documents if item.kind == "plan"]
    assert len(docs) == 1
    text = Path(docs[0].stored_path).read_text(encoding="utf-8")
    assert "насос" in text
    assert "1000" in text
    assert "МПГ00013812" in text
    assert "Условия договора" in text
    assert "Изготовление" in text
    assert "в договоре дела нет" in text
    assert "Шаблон плана без РУКОВОДСТВА.mpp" in text
    assert "ns0:" not in text
    assert 'xmlns="http://schemas.microsoft.com/project"' in text
    assert "<FinishDate>" in text
    assert "<Finish>" in text
    for label in ("Предмет", "Состав", "Количество", "Цена", "НДС", "Сроки", "Оплата", "Комплектность", "Приёмка", "Гарантия"):
        assert label in text
    again = build_work_plan(db, created["id"], fio="Производство")
    db.refresh(row)
    assert len([item for item in row.documents if item.kind == "plan"]) == 1
    assert again["file_name"] == result["file_name"]


def _plan_order(tmp_path, monkeypatch, sections: dict | None = None):
    monkeypatch.setattr("app.services.external_order_plan.BACKEND_ROOT", tmp_path)
    monkeypatch.setattr("app.services.external_order_plan._TEMPLATE_CACHE", tmp_path / "outline.json")
    db = _db()
    created = _create(db)
    row = db.get(ExternalOrder, created["id"])
    row.sections_json = json.dumps(sections or {}, ensure_ascii=False)
    db.commit()
    return db, row


def test_russian_work_calendar_skips_weekends_and_holidays():
    from datetime import date

    from app.services import ru_work_calendar as cal

    assert not cal.is_working(date(2026, 11, 4))
    assert not cal.is_working(date(2026, 11, 7))
    assert cal.is_working(date(2026, 11, 5))
    assert cal.next_working(date(2026, 11, 7)) == date(2026, 11, 9)
    assert cal.add_working_days(date(2026, 11, 2), 5) == date(2026, 11, 9)
    assert not cal.is_working(date(2027, 5, 10))


def test_plan_model_dates_summaries_milestones_and_conditions(tmp_path, monkeypatch):
    from datetime import datetime

    from app.services import ru_work_calendar as cal
    from app.services.external_order_plan import plan_model

    db, row = _plan_order(tmp_path, monkeypatch, {"commercial": {"price": "1000", "term": "60 рабочих дней"}})
    model = plan_model(row, start="2026-10-31")
    assert model["start"] == "2026-11-02"
    tasks = {item["key"]: item for item in model["tasks"]}
    for item in model["tasks"]:
        for stamp in (item["start"], item["finish"]):
            assert cal.is_working(datetime.fromisoformat(stamp).date()), item["name"]
    for item in model["tasks"]:
        if not item["summary"]:
            continue
        children = [
            child for child in model["tasks"]
            if child["wbs"].startswith(f"{item['wbs']}.") or (item["wbs"] == "0" and child is not item)
        ]
        assert item["start"] == min(child["start"] for child in children)
        assert item["finish"] == max(child["finish"] for child in children)
    milestones = {item["key"] for item in model["tasks"] if item["milestone"]}
    assert milestones <= {"committee", "contract", "ship", "pay"}
    assert not tasks["psi"]["milestone"] and tasks["psi"]["duration_days"] > 0
    assert not tasks["accept"]["milestone"] and tasks["accept"]["duration_days"] > 0
    run = sum(tasks[key]["duration_days"] for key in ("kd", "omto", "make", "psi", "accept"))
    assert run == 60
    assert tasks["kd"]["source"] == "дело"
    assert tasks["request"]["source"] == "норматив"
    conds = [item for item in model["tasks"] if item["key"].startswith("cond_")]
    assert len(conds) == 10
    assert all(item["duration_days"] == 0 and not item["milestone"] for item in conds)
    assert all(item["start"] == tasks["contract"]["start"] for item in conds)
    assert tasks["cond_price"]["notes"] == "1000"
    assert tasks["cond_vat"]["notes"] == "в договоре дела нет"
    codes = {(item["code"], item.get("key")) for item in model["warnings"]}
    assert ("condition_missing", "cond_vat") in codes
    assert ("norm_duration", "request") in codes
    assert tasks["kd"]["resource"] == "kb" and tasks["kd"]["wbs"] == "2.1"


def test_plan_overrides_and_preview_writes_nothing(tmp_path, monkeypatch):
    from app.services.external_order_plan import preview_work_plan

    db, row = _plan_order(tmp_path, monkeypatch)
    before = preview_work_plan(db, row.id, start="2026-11-02")
    after = preview_work_plan(
        db,
        row.id,
        start="2026-11-02",
        overrides={"kd": {"duration_days": 20, "resource": "production"}, "contract": {"duration_days": 5}},
    )
    kd = next(item for item in after["tasks"] if item["key"] == "kd")
    assert kd["duration_days"] == 20 and kd["source"] == "вручную" and kd["resource"] == "production"
    assert after["finish"] > before["finish"]
    contract = next(item for item in after["tasks"] if item["key"] == "contract")
    assert contract["milestone"] and contract["duration_days"] == 0
    db.refresh(row)
    assert not [item for item in row.documents if item.kind == "plan"]
    assert not list(tmp_path.glob("storage/**/*.xml"))


def test_plan_xml_is_valid_project_file(tmp_path, monkeypatch):
    from xml.etree import ElementTree as ET

    from app.services.external_order_plan import plan_model, plan_xml

    db, row = _plan_order(tmp_path, monkeypatch, {"onec": {"contract_number": "МПГ1"}})
    model = plan_model(row, start="2026-12-28")
    root = ET.fromstring(plan_xml(model))
    ns = {"p": "http://schemas.microsoft.com/project"}
    assert root.find("p:Resources/p:Resource", ns) is not None
    assert root.find("p:Assignments/p:Assignment", ns) is not None
    exceptions = root.findall("p:Calendars/p:Calendar/p:Exceptions/p:Exception", ns)
    assert any(item.find("p:TimePeriod/p:FromDate", ns).text.startswith("2026-12-31") for item in exceptions)
    outline = [item.find("p:OutlineNumber", ns).text for item in root.findall("p:Tasks/p:Task", ns)]
    assert "2.1" in outline and outline[0] == "0"


def test_plan_uses_template_outline_cache(tmp_path, monkeypatch):
    from app.services.external_order_plan import plan_model, save_template_outline

    db, row = _plan_order(tmp_path, monkeypatch)
    save_template_outline(
        [
            {"name": "Проект", "level": 1, "summary": True},
            {"name": "Разработка КД", "level": 2, "duration_days": 7, "resource": "КБ и ГСПП"},
            {"name": "Изготовление изделия", "level": 2, "duration_days": 12},
            {"name": "Отгрузка", "level": 2, "milestone": True},
        ],
        fio="РП",
    )
    model = plan_model(row, start="2026-11-02")
    assert model["outline_source"] == "template"
    names = [item["name"] for item in model["tasks"] if item["group"] == "work"]
    assert names[:4] == ["Проект", "Разработка КД", "Изготовление изделия", "Отгрузка"]
    kd = next(item for item in model["tasks"] if item["name"] == "Разработка КД")
    assert kd["duration_days"] == 7 and kd["resource"] == "kb"
    assert not any(item["code"] == "template_missing" for item in model["warnings"])


def test_plan_mpp_upload_replaces_xml_draft(tmp_path, monkeypatch):
    import base64

    from app.services.external_order_plan import build_work_plan, store_mpp

    db, row = _plan_order(tmp_path, monkeypatch)
    build_work_plan(db, row.id, fio="РП")
    try:
        store_mpp(db, row.id, fio="РП", role="rp", filename="x.mpp", content_b64=base64.b64encode(b"nope" * 200).decode())
    except ExternalOrderError as exc:
        assert "Project" in exc.detail
    else:
        raise AssertionError("не .mpp принят")
    raw = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 1024
    store_mpp(db, row.id, fio="РП", role="rp", filename="План работ ВЗ.mpp", content_b64=base64.b64encode(raw).decode())
    db.commit()
    db.refresh(row)
    docs = [item for item in row.documents if item.kind == "plan"]
    assert len(docs) == 1 and docs[0].file_name.endswith(".mpp")


def test_invoke_tool_plan_preview_returns_questions(tmp_path, monkeypatch):
    from app.services import external_orders as eo

    db, row = _plan_order(tmp_path, monkeypatch)
    monkeypatch.setattr("app.db.session.SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)
    body = eo.invoke_tool({"action": "plan_preview", "order_id": row.code}, fio="агент")
    assert body["tasks"] and body["questions"]
    assert "не выдумывай" in body["agent_limits"]
    assert not [item for item in row.documents if item.kind == "plan"]


def test_stage_passports_and_role_questions_in_order_detail():
    from app.services.external_orders import get_order

    db = _db()
    order = _create(db)
    passports = order["stage_passports"]
    assert [p["id"] for p in passports] == [
        "request",
        "calc",
        "committee",
        "tkp",
        "contract",
        "run",
        "ship",
        "pay",
    ]
    req_passport = passports[0]
    assert req_passport["state"] == "current"
    assert req_passport["checks_done"] == 0
    assert req_passport["checks_total"] == 5
    assert len(req_passport["open_checks"]) == 5
    assert req_passport["required_docs"] == [
        {"kind": "tz", "label": "ТЗ", "present": False, "approved": False, "version": ""}
    ]
    assert "Готово к Комитету заблокировано" in req_passport["blocker"]
    assert all(p["state"] == "upcoming" for p in passports[1:])

    role_qs = order["role_questions"]
    ks_field_ids = [q["id"] for q in role_qs["ks"]]
    assert "section:commercial.price" in ks_field_ids
    assert "section:commercial.vat" in ks_field_ids
    first_ks_check = next(c for c in order["checks"] if c["owner_role"] == "ks" and c["gate"] == "before_calc")
    assert f"check:{first_ks_check['id']}" in ks_field_ids

    uploaded = _upload(db, order["id"], "tz", "tz.docx", _docx(["Предмет: расходомер", "Цена 500 руб."]))
    tz_doc = next(d for d in uploaded["documents"] if d["kind"] == "tz")
    approve_order_file(db, order["id"], tz_doc["id"], role="ks", fio="Ильченко")
    confirm_check(db, order["id"], first_ks_check["id"], role="ks", fio="Ильченко", evidence="ТЗ v1")
    patch_order(
        db,
        order["id"],
        role="ks",
        fio="Ильченко",
        fields={"sections": {"commercial": {"price": "500 руб."}}},
    )

    refreshed = get_order(db, order["id"])
    req_after = refreshed["stage_passports"][0]
    assert req_after["checks_done"] == 1
    assert req_after["required_docs"][0] == {
        "kind": "tz",
        "label": "ТЗ",
        "present": True,
        "approved": True,
        "version": "v1",
    }
    ks_after_ids = [q["id"] for q in refreshed["role_questions"]["ks"]]
    assert "section:commercial.price" not in ks_after_ids
    assert f"check:{first_ks_check['id']}" not in ks_after_ids
    warranty_gap = next(g for g in refreshed["gaps"] if g["field"] == "warranty" and g["status"] == "open")
    legal_q_ids = [q["id"] for q in refreshed["role_questions"]["legal"]]
    assert f"gap:{warranty_gap['id']}" in legal_q_ids


def test_run_copilot_auto_prepare_and_interactive_answers(monkeypatch, tmp_path):
    from app.services.external_orders import run_copilot

    monkeypatch.setattr("app.services.external_order_case.BACKEND_ROOT", tmp_path)
    db = _db()
    order = _create(db)
    _upload(db, order["id"], "contract", "dogovor.docx", _docx(["Цена 1200 руб."]))
    reloaded = db.get(ExternalOrder, order["id"])
    warranty_gap = next(g for g in reloaded.gaps if g.field == "warranty" and g.status == "open")
    ks_check = next(c for c in reloaded.checks if c.owner_role == "ks" and c.gate == "before_calc")
    kb_check = next(c for c in reloaded.checks if c.owner_role == "kb")

    res = run_copilot(
        db,
        order["id"],
        role="ks",
        fio="Ильченко",
        step_id="zpr",
        message="Уточняю коммерческие условия",
        answers={
            "section:commercial.vat": "20% в т.ч.",
            "section:technical.kd": "КД разработана",
            f"check:{ks_check.id}": "Запрос зарегистрирован в журнале",
            f"check:{kb_check.id}": "Состав согласован с ГК",
            f"gap:{warranty_gap.id}": "Гарантия 24 месяца по письму",
        },
        auto_prepare=True,
    )

    updated = res["order"]
    assert updated["sections"]["commercial"]["vat"] == "20% в т.ч."
    assert not updated["sections"]["technical"].get("kd")
    updated_ks_check = next(c for c in updated["checks"] if c["id"] == ks_check.id)
    assert updated_ks_check["status"] == "done"
    assert updated_ks_check["evidence"] == "Запрос зарегистрирован в журнале"
    updated_kb_check = next(c for c in updated["checks"] if c["id"] == kb_check.id)
    assert updated_kb_check["status"] != "done"

    proposal_fields = {p["field"]: p for p in res["proposals"]}
    assert "section:commercial.currency" in proposal_fields
    assert "section:technical.kd" in proposal_fields
    assert proposal_fields["section:technical.kd"]["owner_role"] == "kb"
    assert f"check:{kb_check.id}" in proposal_fields
    assert proposal_fields[f"check:{kb_check.id}"]["owner_role"] == "kb"
    assert "warranty" in proposal_fields
    assert "draft_1c_memo" in proposal_fields
    assert res["questions"]
    assert any("Записано поле" in line for line in res["log"])

    legal_res = run_copilot(
        db,
        order["id"],
        role="legal",
        fio="Юрист",
        step_id="contract",
        answers={f"gap:{warranty_gap.id}": "24 месяца с даты отгрузки"},
        auto_prepare=False,
    )
    closed_gap = next(g for g in legal_res["order"]["gaps"] if g["id"] == warranty_gap.id)
    assert closed_gap["status"] == "closed"


def test_accept_finding_side_effects_accept_role_and_reject():
    from app.services.external_orders import accept_finding, accept_role_findings, reject_finding

    db = _db()
    order = _create(db)
    ks_check = next(c for c in order["checks"] if c["owner_role"] == "ks" and c["gate"] == "before_calc")
    fin_check = next(c for c in order["checks"] if c["owner_role"] == "finance" and c["gate"] == "before_committee")

    proposed = propose(
        db,
        order["id"],
        fio="агент",
        section_proposals=[
            {"section": "commercial", "key": "price", "value": "3 500 000 руб.", "owner_role": "ks"},
            {"section": "commercial", "key": "discount", "value": "5%", "owner_role": "ks"},
            {"section": "calculation", "key": "mcr", "value": "3 100 000 руб.", "owner_role": "finance"},
            {"section": "calculation", "key": "margin", "value": "18%", "owner_role": "finance"},
        ],
        check_proposals=[
            {"check_id": ks_check["id"], "evidence": "ТЗ приложено", "owner_role": "ks"},
            {"check_id": fin_check["id"], "evidence": "Расчёт МЦР выполнен", "owner_role": "finance"},
        ],
        risk_proposals=[
            {
                "title": "Задержка поставки первичного преобразователя",
                "impact": "Сдвиг срока на 14 дней",
                "measure": "Резервный поставщик",
                "source": "ОМТО",
                "owner_role": "rp",
            }
        ],
    )
    by_field = {f["field"]: f for f in proposed["findings"] if f["status"] == "draft"}

    try:
        accept_finding(db, order["id"], by_field["section:commercial.price"]["id"], role="legal", fio="Юрист")
    except ExternalOrderError as exc:
        assert exc.status == 403
    else:
        raise AssertionError("чужая роль приняла вывод цены")

    after_price = accept_finding(
        db, order["id"], by_field["section:commercial.price"]["id"], role="ks", fio="Ильченко"
    )
    assert after_price["sections"]["commercial"]["price"] == "3 500 000 руб."

    after_check = accept_finding(
        db, order["id"], by_field[f"check:{ks_check['id']}"]["id"], role="ks", fio="Ильченко"
    )
    assert next(c for c in after_check["checks"] if c["id"] == ks_check["id"])["status"] == "done"

    after_risk = accept_finding(
        db, order["id"], by_field["risk:draft"]["id"], role="rp", fio="РП"
    )
    assert any(r["title"] == "Задержка поставки первичного преобразователя" for r in after_risk["risks"])

    after_reject = reject_finding(
        db, order["id"], by_field["section:commercial.discount"]["id"], role="ks", fio="Ильченко"
    )
    rejected_item = next(f for f in after_reject["findings"] if f["id"] == by_field["section:commercial.discount"]["id"])
    assert rejected_item["status"] == "rejected"
    assert not after_reject["sections"]["commercial"].get("discount")

    after_batch = accept_role_findings(db, order["id"], role="finance", fio="Финансист")
    assert after_batch["sections"]["calculation"]["mcr"] == "3 100 000 руб."
    assert after_batch["sections"]["calculation"]["margin"] == "18%"
    assert next(c for c in after_batch["checks"] if c["id"] == fin_check["id"])["status"] == "done"


def test_accept_baseline_draft_stays_until_every_field_is_present():
    from app.services.external_orders import accept_finding

    db = _db()
    order = _create(db)
    draft = ExternalOrderFinding(
        id="f-base-1",
        order_id=order["id"],
        field="baseline:draft",
        value=json.dumps({"composition": "расходомер", "cost": "100"}, ensure_ascii=False),
        source_ref="дело",
        owner_role="finance",
        status="draft",
        proposed_by="авто-проверка",
    )
    db.add(draft)
    db.commit()

    try:
        accept_finding(db, order["id"], "f-base-1", role="finance", fio="Финансы")
    except ExternalOrderError as exc:
        assert exc.status == 400
        assert "МЦР" in exc.detail and "маржа" in exc.detail and "БДДС" in exc.detail and "сроки" in exc.detail
    else:
        raise AssertionError("неполный черновик базовой версии принят")

    left = db.get(ExternalOrderFinding, "f-base-1")
    assert left is not None and left.status == "draft"
    assert db.query(ExternalOrderBaseline).count() == 0

    left.value = json.dumps(
        {
            "composition": "расходомер",
            "cost": "100",
            "mcr": "80",
            "margin": "20%",
            "bdds": "аванс 50%",
            "deadlines": "90 дней",
        },
        ensure_ascii=False,
    )
    db.commit()
    accepted = accept_finding(db, order["id"], "f-base-1", role="finance", fio="Финансы")
    assert accepted["baselines"][-1]["code"].startswith("БВ-")
    assert next(item for item in accepted["findings"] if item["id"] == "f-base-1")["status"] == "accepted"


def test_invoke_tool_read_full_auto_prepare_propose_and_draft_1c(monkeypatch, tmp_path):
    from app.services.external_orders import get_order, invoke_tool

    monkeypatch.setattr("app.services.external_order_case.BACKEND_ROOT", tmp_path)
    db = _db()
    monkeypatch.setattr(db, "close", lambda: None)
    monkeypatch.setattr("app.db.session.SessionLocal", lambda: db)

    order = _create(db)
    _upload(db, order["id"], "tz", "tz.docx", _docx(["Предмет поставки: расходомер ультразвуковой"]))

    full = invoke_tool(
        {"action": "read_full", "order_id": order["code"], "role": "ks", "step_id": "zpr"},
        fio="Ильченко",
    )
    assert full["code"] == order["code"]
    assert len(full["stage_passports"]) == 8
    assert full["stage_passport"]["id"] == "request"
    assert full["document_excerpts"]
    assert "Предмет поставки: расходомер ультразвуковой" in full["document_excerpts"][0]["paragraphs"]
    assert full["questions"]
    assert "role_questions" in full

    prep = invoke_tool(
        {"action": "auto_prepare", "order_id": order["id"], "role": "committee", "step_id": "committee"},
        fio="Секретарь",
    )
    assert prep["ok"] is True
    assert prep["stage_passport"]["id"] == "committee"
    prep_fields = {p["field"] for p in prep["proposals"]}
    assert "baseline:draft" in prep_fields
    assert "draft_1c_protocol" in prep_fields

    kb_check = next(c for c in order["checks"] if c["owner_role"] == "kb")
    prop_res = invoke_tool(
        {
            "action": "propose",
            "order_id": order["id"],
            "section_proposals": [
                {"section": "technical", "key": "limits", "value": "Давление до 16 МПа", "owner_role": "kb"}
            ],
            "check_proposals": [
                {"check_id": kb_check["id"], "evidence": "КД проверена", "owner_role": "kb"}
            ],
            "risk_proposals": [
                {"title": "Сложная оснастка", "impact": "7 дней", "measure": "Параллельный запуск", "owner_role": "rp"}
            ],
        },
        fio="Агент КБ",
    )
    assert prop_res["proposed"] == 3
    finding_kinds = {f["field"]: f["kind"] for f in prop_res["findings"]}
    assert finding_kinds["section:technical.limits"] == "section"
    assert finding_kinds[f"check:{kb_check['id']}"] == "check"
    assert finding_kinds["risk:draft"] == "risk"

    draft_1c = invoke_tool(
        {
            "action": "draft_1c",
            "order_id": order["id"],
            "kind": "directive",
            "title": "Распоряжение о запуске в производство",
            "text": "Начать изготовление расходомера по заказу.",
            "prefill": {"department": "Цех несерийного оборудования", "due_date": "2026-11-15"},
        },
        fio="Агент РП",
    )
    assert draft_1c["ok"] is True
    assert draft_1c["draft"] is True
    assert draft_1c["prefill"]["order_code"] == order["code"]
    assert draft_1c["prefill"]["department"] == "Цех несерийного оборудования"

    detail = get_order(db, order["id"])
    directive_finding = next(f for f in detail["findings"] if f["field"] == "draft_1c_directive")
    assert directive_finding["kind"] == "draft_1c"
    assert directive_finding["prefill"]["due_date"] == "2026-11-15"
    assert directive_finding["prefill"]["customer"] == "Заказчик"

