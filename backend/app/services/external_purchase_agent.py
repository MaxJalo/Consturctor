"""Опубликованный агент закупки под внешний заказ."""

from __future__ import annotations

import copy
from uuid import uuid4

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.user import AppUser
from app.models.workflow import Workflow
from app.services.external_orders import is_zhalybin
from app.services.triggers.service import workflow_is_deleted

TITLE = "ИИ-агент внешних закупок"
GOAL = (
    "Помочь ОМТО провести закупку под внешний несерийный заказ: состав, сроки, "
    "критические позиции и пробелы. Цену поставщика, заказ и стадию утверждает человек."
)
TOOLS = [
    "external_order.case",
    "onec.docflow_document_create",
    "users.current",
]
MODEL_PARAMS: list[dict[str, str]] = []
INSTRUCTIONS = """Ты — специализированный ИИ-агент внешних закупок для службы ОМТО (owner_role=omto).
Твоя задача — подготовить закупку комплектующих и материалов под внешний несерийный заказ: проанализировать спецификацию, сроки поставки, критические позиции, логистику и сформировать черновики для подтверждения сотрудником ОМТО.

Порядок работы:
1. Детерминированная авто-подготовка:
   Сначала вызови `external_order.case(action="auto_prepare", order_id=<id или код>, role="omto")`
   (и при необходимости `action="read_full"` для чтения построчной спецификации `lines` и текстов ТЗ/договора).
2. Формирование черновиков закупки:
   По данным спецификации и дела сразу запиши черновики через `external_order.case(action="propose", ...)`:
   - `check_proposals`: проекты подтверждения пунктов чек-листа ОМТО («Цены и сроки закупок актуальны», «Срок действия исходных цен не истёк», «Закупки и критические позиции обеспечены», «Комплектность, упаковка и маркировка подтверждены», «Логистика согласована»);
   - `diffs`: условие логистики, упаковки и страхования (`B12`);
   - `risk_proposals`: риски срыва сроков поставки критических комплектующих или роста цен поставщиков;
   - `external_order.case(action="draft_1c", kind="memo", ...)`: проект служебной записки или заявки на согласование закупки в 1С ДО.
3. Интерактивный опрос специалиста ОМТО:
   Задай конкретные вопросы по недостающим данным: актуальность КП поставщиков, сроки поставки длинноцикловых позиций, условия доставки и упаковки. Получив ответы пользователя, запиши их черновиками в карточку заказа.

Дальнейший путь ОМТО: цены и сроки до Комитета, обеспечение критических позиций до производственного запуска, комплектность и логистика до отгрузки.
Ты готовишь черновик закупки. Ты не утверждаешь цену поставщика, не размещаешь заказ поставщику и не переводишь стадию.
Черновик не называй фактом и проведённой закупкой.
"""
STEPS = [
    {
        "id": "s1",
        "title": "Авто-подготовка дела и анализ спецификации закупок",
        "tool": "external_order.case",
        "action": "Вызвать action=auto_prepare (role=omto) и при необходимости action=read_full для анализа позиций спецификации.",
    },
    {
        "id": "s2",
        "title": "Запись черновиков чек-листов ОМТО, рисков и СЗ в 1С ДО",
        "tool": "external_order.case",
        "action": "Сохранить черновики через action=propose и action=draft_1c (kind=memo).",
    },
    {
        "id": "s3",
        "title": "Интерактивный опрос ОМТО по срокам и критическим позициям",
        "tool": "external_order.case",
        "action": "Показать подготовленные черновики и задать вопросы по срокам поставки, ценам поставщиков и логистике.",
    },
]


def playbook() -> dict:
    return {
        "name": TITLE,
        "goal": GOAL,
        "instructions": INSTRUCTIONS.strip(),
        "example_run": "Открой заказ и собери черновик закупки: что купить, к какому сроку и чего не хватает. В 1С ничего не отправляй.",
        "steps": STEPS,
        "tools": TOOLS,
        "model_params": MODEL_PARAMS,
    }


def _owner(db: Session) -> AppUser | None:
    rows = db.query(AppUser).all()
    return next((item for item in rows if is_zhalybin(item.fio or "")), None)


def _existing(db: Session) -> Workflow | None:
    rows = db.query(Workflow).filter(Workflow.title == TITLE, Workflow.phase == "done").all()
    for row in rows:
        if workflow_is_deleted(row):
            continue
        local = row.local_run if isinstance(row.local_run, dict) else {}
        if local.get("library_source_id"):
            continue
        return row
    return None


def _apply(row: Workflow) -> None:
    local = dict(row.local_run or {})
    local["playbook"] = playbook()
    local["published"] = True
    local["status"] = "active"
    local["purpose"] = "functional"
    local["tools"] = TOOLS
    local.pop("paused", None)
    local.pop("run_on_server", None)
    local.pop("library_source_id", None)
    row.local_run = local
    plan = dict(row.plan_json or {})
    plan["title"] = TITLE
    plan["goal"] = GOAL
    runtime = dict(plan.get("runtime") or {})
    runtime["tools"] = TOOLS
    plan["runtime"] = runtime
    row.plan_json = plan
    row.phase = "done"
    row.notes = GOAL
    flag_modified(row, "local_run")
    flag_modified(row, "plan_json")


def _agent_snapshot(row: Workflow) -> tuple:
    return (row.title, row.phase, row.notes, copy.deepcopy(row.local_run), copy.deepcopy(row.plan_json))


def ensure_agent(db: Session) -> Workflow | None:
    row = _existing(db)
    if row is None:
        owner = _owner(db)
        if owner is None:
            return None
        row = Workflow(id=str(uuid4()), user_id=owner.id, title=TITLE, phase="done", notes=GOAL)
        db.add(row)
    before = None if row in db.new else _agent_snapshot(row)
    _apply(row)
    if before != _agent_snapshot(row):
        db.commit()
        db.refresh(row)
    else:
        db.expire(row)
    return row
