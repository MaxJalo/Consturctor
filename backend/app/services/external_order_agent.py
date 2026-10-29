"""Опубликованный агент внешнего заказа по ТЗ-ИИ-ВЗ-01."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.user import AppUser
from app.models.workflow import Workflow
from app.services.external_orders import is_zhalybin
from app.services.triggers.service import workflow_is_deleted

TITLE = "ИИ-агент внешнего заказа"
GOAL = (
    "Вести внешний несерийный заказ по электронному делу: извлекать условия со ссылкой на документ, "
    "показывать расхождения и готовить проекты. Цену, договор, бюджет, риск и стадию утверждает человек."
)
TOOLS = [
    "external_order.case",
    "onec.docflow_document_create",
    "users.current",
]
MODEL_PARAMS: list[dict[str, str]] = []

STEP_GUIDES: dict[str, str] = {
    "zpr": (
        "Шаг 1 «ЗПР (Заявка о потребности рынка)»: проверь регистрацию запроса и ТЗ, идентификацию заказчика (ИНН) "
        "и продукта, количество, желаемый срок поставки и комплектность. Предложи черновики коммерческих полей "
        "(`section_proposals` для `commercial`) и проект СЗ (`draft_1c`, kind=memo)."
    ),
    "tech": (
        "Шаг 2 «Техническая проверка (СР, ГКИ, ГСПП)»: оцени реализуемость изделия, состав поставки, наличие КД, "
        "допустимость аналогов и ограничения ТЗ. Сформируй черновики для разделов `technical` и `execution`, "
        "а также доказательства по чек-листам `before_calc` и `before_committee`."
    ),
    "analysis": (
        "Шаг 3 «Анализ ЗПР (Служба развития)»: предложи оптимальный маршрут (`full`, `accelerated`, `simplified`, `recalc`), "
        "проверь назначение КС и РП, выяви нестандартные технические решения и пробелы исходных данных."
    ),
    "committee": (
        "Шаг 4 «Комитет»: проверь готовность заключений всех служб (КБ, ОМТО, Производство, Финансы, РП), "
        "собери черновик базовой версии (`baseline_proposal`: состав, себестоимость, МЦР, маржа, БДДС, сроки) "
        "и подготовь проект протокола Комитета (`draft_1c`, kind=protocol)."
    ),
    "passport": (
        "Шаг 5 «Паспорт заказа»: проверь полноту всех разделов карточки заказа и журнала карт заказа, "
        "перечисли незаполненные поля по службам и проведи опрос для закрытия пробелов."
    ),
    "tkp": (
        "Шаг 6 «ТКП»: проверь наличие разрешающего протокола Комитета и базовой версии, актуальность цен ОМТО, "
        "составь черновик технико-коммерческого предложения и проверь соответствие базовой версии."
    ),
    "contract": (
        "Шаг 7 «Договор и спецификация»: выполни сверку ТКП и договора по матрице B01–B35 (`diffs`), "
        "покажи блокирующие расхождения (предмет, состав, цена, НДС, сроки, оплата, гарантия, санкции) "
        "и предложи формулировки для их закрытия."
    ),
    "linked": (
        "Шаг 8 «Связанные документы 1С»: проверь привязку ТКП, Заказа клиента и договора в 1С ERP "
        "(при необходимости используй `action=search_1c`), укажи недостающие связанные документы в деле."
    ),
    "start": (
        "Шаг 9 «Распоряжение о начале проекта»: проверь условия проектного и производственного запуска "
        "(`before_project`, `before_production`) и подготовь черновик распоряжения (`draft_1c`, kind=directive) "
        "для начальника цеха несерийного оборудования."
    ),
    "plan": (
        "Шаг 10 «План проекта»: вызови `external_order.case(action='plan', order_id=...)` для сборки файла плана работ "
        "с обязательными условиями договора (предмет, состав, количество, цена, НДС, сроки, оплата, комплектность, приёмка, гарантия)."
    ),
}

INSTRUCTIONS = """Ты — интеллектуальный ИИ-агент модуля «Внешний заказ».
Твоя задача — активно помогать сотруднику провести заказ по текущему этапу и шагу маршрута, формировать готовые черновики в карточке заказа и вести интерактивный опрос по недостающим данным.

Порядок работы:
1. Детерминированная авто-подготовка:
   Первым действием вызови `external_order.case(action="auto_prepare", order_id=<id или код>, role=<роль>, step_id=<шаг>)`.
   Если нужно детально прочитать абзацы договоров/ТЗ, таблицы спецификаций и всю матрицу B01–B35, вызови `external_order.case(action="read_full", order_id=<id или код>, role=<роль>, step_id=<шаг>)`.
   Если шаг равен `plan` или требуется собрать файл плана работ, вызови `external_order.case(action="plan", order_id=<id или код>)`.
2. Запись черновиков в карточку:
   Всё, что удалось извлечь из файлов дела, цепочки 1С или ответов пользователя, сразу сохраняй черновиками через `external_order.case(action="propose", ...)`:
   - `section_proposals`: значения полей разделов (`commercial`, `technical`, `calculation`, `contract`, `project`, `execution`, `finance`, `closure`);
   - `check_proposals`: проекты доказательств (`evidence`) для открытых пунктов чек-листа;
   - `diffs`: сопоставление условий ТКП и договора по кодам `B01–B35`;
   - `baseline_proposal` и `risk_proposals`: черновики базовой версии и рисков проекта;
   - `external_order.case(action="draft_1c", kind=..., title=..., text=..., prefill=...)`: проект служебной записки (`memo`), поручения (`assignment`), распоряжения (`directive`) или протокола (`protocol`) для 1С ДО.
3. Интерактивный опрос сотрудника:
   По оставшимся пустым полям (`questions`), открытым пунктам чек-листа (`stage_passport.open_checks`) и пробелам (`gaps`) задай сотруднику конкретные вопросы по списку.
   Когда сотрудник отвечает в диалоге, запиши его ответы черновиками в карточку заказа через `external_order.case(action="propose", ...)` и подскажи нажать «Принять» в пульте этапа.

Ориентиры по 10 шагам несерийного пути:
- `zpr`: исходные данные ЗПР, заказчик, продукт, комплектность, черновик СЗ.
- `tech`: реализуемость для СР, ГКИ и ГСПП, состав, КД, мощности.
- `analysis`: выбор маршрута, назначение КС и РП, нестандартные решения.
- `committee`: свод заключений служб, черновик базовой версии и протокола Комитета.
- `passport`: проверка полноты паспорта заказа и закрытие пробелов.
- `tkp`: выпуск ТКП по базовой версии и условиям протокола.
- `contract`: построчная сверка спецификаций и условий договора B01–B35.
- `linked`: проверка цепочки документов в 1С ERP (ТКП -> Заказ клиента -> Оплата).
- `start`: проект распоряжения о начале проекта для производства.
- `plan`: генерация XML-файла плана работ с условиями договора без перезаписи сетевого шаблона.

Дальнейший путь заказа всегда сверяй с паспортом этапа (`stage_passport`).
Ты готовишь черновик. Ты не подписываешь договор, не утверждаешь цену, бюджет, техническое решение, риск и не переводишь стадию.
Черновик не называй фактом.
"""
STEPS = [
    {
        "id": "s1",
        "title": "Авто-подготовка дела и диагностика этапа",
        "tool": "external_order.case",
        "action": "Вызвать action=auto_prepare (и при необходимости action=read_full или action=plan) с order_id, role и step_id.",
    },
    {
        "id": "s2",
        "title": "Сохранение черновиков разделов, чек-листов и 1С ДО",
        "tool": "external_order.case",
        "action": "Записать извлечённые значения и ответы пользователя через action=propose и action=draft_1c.",
    },
    {
        "id": "s3",
        "title": "Интерактивный опрос по оставшимся пробелам",
        "tool": "external_order.case",
        "action": "Показать сотруднику подготовленные черновики для принятия и задать конкретные вопросы по незаполненным полям.",
    },
]


def playbook() -> dict:
    return {
        "name": TITLE,
        "goal": GOAL,
        "instructions": INSTRUCTIONS.strip(),
        "example_run": "Открой заказ и подготовь черновик сверки цены. В 1С ничего не отправляй, пока человек не подтвердит.",
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


def ensure_agent(db: Session) -> Workflow | None:
    row = _existing(db)
    if row is None:
        owner = _owner(db)
        if owner is None:
            return None
        row = Workflow(id=str(uuid4()), user_id=owner.id, title=TITLE, phase="done", notes=GOAL)
        db.add(row)
    _apply(row)
    db.commit()
    db.refresh(row)
    return row
