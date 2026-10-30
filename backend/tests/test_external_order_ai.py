import json

from app.models.external_order import ExternalOrder
from app.services.external_order_ai import AI_PROPOSER, parse_ai_json
from app.services.external_orders import accept_finding, accept_role_findings, patch_order, run_copilot
from tests.test_external_orders import _create, _db, _docx, _upload


def _answer(order: ExternalOrder, check_id: str) -> str:
    return json.dumps(
        {
            "fields": [
                {
                    "field": "section:commercial.price",
                    "value": "1 200 руб.",
                    "source": "Договор dogovor.docx",
                    "quote": "Цена 1200 руб.",
                    "confidence": "high",
                },
                {"field": "section:commercial.discount", "value": "5%", "source": "", "quote": ""},
                {"field": "section:unknown.key", "value": "x", "source": "дело"},
                {
                    "field": "section:technical.limits",
                    "value": "Давление до 16 МПа",
                    "source": "ТЗ v1",
                    "quote": "до 16 МПа",
                    "confidence": "low",
                },
            ],
            "checks": [{"check_id": check_id, "evidence": "Заказ в карточке", "source": f"Карточка {order.code}"}],
            "questions": [
                {
                    "field": "section:commercial.discount",
                    "question": "Есть ли скидка?",
                    "why": "Без скидки не считается маржа",
                    "suggestion": "",
                    "suggestion_source": "",
                },
                {"field": "section:none.none", "question": "лишний"},
            ],
            "answer_checks": [
                {"field": "section:commercial.vat", "ok": False, "note": "В договоре НДС 20%", "followup": "Сверить НДС"}
            ],
        },
        ensure_ascii=False,
    )


def test_parse_ai_json_strips_fence_and_text() -> None:
    data = parse_ai_json('Вот ответ:\n```json\n{"fields": [{"field": "a"}], "questions": "bad"}\n```')
    assert data["fields"] == [{"field": "a"}]
    assert data["questions"] == []


def test_ai_fills_only_sourced_empty_fields(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("app.services.external_order_case.BACKEND_ROOT", tmp_path)
    db = _db()
    order = _create(db)
    _upload(db, order["id"], "contract", "dogovor.docx", _docx(["Цена 1200 руб."]))
    row = db.get(ExternalOrder, order["id"])
    check = next(c for c in row.checks if c.status not in {"done", "not_applicable"})
    prompts: list[str] = []

    def runner(prompt: str) -> str:
        prompts.append(prompt)
        return _answer(row, check.id)

    res = run_copilot(
        db,
        order["id"],
        role="ks",
        fio="Ильченко",
        answers={"section:commercial.vat": "18%"},
        use_ai=True,
        ai_runner=runner,
    )

    assert "Цена 1200 руб." in prompts[0]
    assert res["ai"]["ok"] is True
    ai_findings = {f["field"]: f for f in res["order"]["findings"] if f["filled_by"] == "ai"}
    assert ai_findings["section:commercial.price"]["source_ref"] == "Договор dogovor.docx"
    assert ai_findings["section:commercial.price"]["confidence"] == "ai:high"
    assert ai_findings["section:technical.limits"]["owner_role"] == "kb"
    assert "section:commercial.discount" not in ai_findings
    assert "section:unknown.key" not in ai_findings
    assert ai_findings[f"check:{check.id}"]["proposed_by"] == AI_PROPOSER
    marks = res["order"]["ai_fields"]
    assert marks["commercial.price"]["status"] == "draft"
    discount = next(q for q in res["questions"] if q["id"] == "section:commercial.discount")
    assert discount["ai_why"] == "Без скидки не считается маржа"
    assert res["ai"]["answer_checks"]["section:commercial.vat"]["followup"] == "Сверить НДС"


def test_ai_mark_stays_until_manual_rewrite(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("app.services.external_order_case.BACKEND_ROOT", tmp_path)
    db = _db()
    order = _create(db)
    row = db.get(ExternalOrder, order["id"])
    check = next(c for c in row.checks if c.status not in {"done", "not_applicable"})
    res = run_copilot(db, order["id"], role="ks", fio="Ильченко", use_ai=True, ai_runner=lambda _p: _answer(row, check.id))
    price = next(f for f in res["order"]["findings"] if f["field"] == "section:commercial.price")
    limits = next(f for f in res["order"]["findings"] if f["field"] == "section:technical.limits")

    after_ks = accept_role_findings(db, order["id"], role="rp", fio="РП")
    assert next(f for f in after_ks["findings"] if f["id"] == limits["id"])["status"] == "draft"

    accepted = accept_finding(db, order["id"], price["id"], role="ks", fio="Ильченко")
    assert accepted["sections"]["commercial"]["price"] == "1 200 руб."
    assert accepted["ai_fields"]["commercial.price"]["status"] == "accepted"

    rewritten = patch_order(
        db, order["id"], role="ks", fio="Ильченко", fields={"sections": {"commercial": {"price": "1 300 руб."}}}
    )
    assert "commercial.price" not in rewritten["ai_fields"]


def test_ai_failure_keeps_deterministic_prepare(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("app.services.external_order_case.BACKEND_ROOT", tmp_path)
    db = _db()
    order = _create(db)

    def broken(_prompt: str) -> str:
        raise RuntimeError("Cursor SDK: timeout")

    res = run_copilot(db, order["id"], role="ks", fio="Ильченко", use_ai=True, ai_runner=broken)
    assert res["ai"]["ok"] is False
    assert any("ИИ не ответил" in line for line in res["log"])
    assert any(f["field"] == "section:commercial.currency" for f in res["proposals"])


def test_baseline_draft_has_no_invented_numbers(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("app.services.external_order_case.BACKEND_ROOT", tmp_path)
    db = _db()
    order = _create(db)
    res = run_copilot(db, order["id"], role="finance", fio="Финансы")
    draft = next(f for f in res["order"]["findings"] if f["field"] == "baseline:draft")
    body = json.loads(draft["value"])
    assert body["mcr"] == "" and body["margin"] == "" and body["deadlines"] == ""
