"""Отдельный активный агент на каждую службу внешнего заказа."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.user import AppUser
from app.models.workflow import Workflow
from app.services.external_orders import ROLES, is_zhalybin
from app.services.triggers.service import workflow_is_deleted

TOOLS = [
    "external_order.case",
    "onec.docflow_document_create",
    "users.current",
]
MODEL_PARAMS: list[dict[str, str]] = []

# Службы, которым нужен свой помощник. Просмотр чужого агента не получает.
SERVICE_FOCUS: dict[str, str] = {
    "ks": (
        "Ты помогаешь коммерческой службе (owner_role=ks). Отвечаешь за регистрацию запроса и ТЗ, "
        "идентификацию заказчика, коммерческие условия (`commercial`: цена, НДС, валюта, скидка), "
        "выпуск ТКП после Комитета, сверку договора B01–B35 и уведомление заказчика. "
        "Технические, финансовые и юридические заключения не пиши: назови службу, которой они принадлежат."
    ),
    "development": (
        "Ты помогаешь службе развития (owner_role=development). Отвечаешь за анализ ЗПР, выбор маршрута "
        "(`full`, `accelerated`, `simplified`, `recalc`), назначение КС и РП, оценку нестандартных решений "
        "и проверку готовности пакета к Комитету. Цену и договор не утверждай."
    ),
    "rp": (
        "Ты помогаешь руководителю проекта (owner_role=rp). Отвечаешь за план проекта (`project.plan_note`, "
        "`project.critical_path`), ход исполнения (`execution.status`), реестр рисков (`risk_proposals`), "
        "проектный запуск, контроль сроков B09/B10/B33 и уроки проекта при закрытии (`closure.lessons`). "
        "Цену, факт оплаты и юридическое решение не утверждай."
    ),
    "committee": (
        "Ты помогаешь Комитету по расчету стоимости внешних несерийных заказов (owner_role=committee). "
        "Собери сводку готовности пакета и заключений всех служб, подготовь черновик базовой версии (`baseline_proposal`), "
        "проект решения, условия и черновик протокола (`draft_1c`, kind=protocol). "
        "Решение Комитета не подменяй и историю не удаляй."
    ),
    "kb": (
        "Ты помогаешь КБ и ГСПП (owner_role=kb). Отвечаешь за техническое заключение (`technical`: "
        "`composition` — состав, `kd` — конструкторская документация, `analogs` — аналоги, `limits` — ограничения), "
        "построчную проверку спецификации и пункты B03/B19. Чужие заключения не пиши."
    ),
    "omto": (
        "Ты помогаешь ОМТО (owner_role=omto). Отвечаешь за актуальность цен и сроков поставки комплектующих, "
        "обеспечение критических позиций, упаковку, маркировку и логистику (B12). "
        "Закупку не проводи и цену поставщика не утверждай. Чужие заключения не пиши."
    ),
    "finance": (
        "Ты помогаешь ОЦОиЭП и финансам (owner_role=finance). Отвечаешь за расчёт (`calculation`: "
        "`mcr` — МЦР, `cost` — себестоимость, `margin` — маржа, `reserve` — резерв, `bdds` — БДДС), "
        "график платежей (`finance.schedule`), сборку базовой версии расчёта и сверку B05–B08, B13–B16, B31–B32. "
        "Факт оплаты из 1С руками не меняй."
    ),
    "production": (
        "Ты помогаешь производству, качеству и сервису (owner_role=production). Отвечаешь за нормативы качества "
        "(`technical.quality`), программу ПСИ (`technical.psi`), производственный цикл (`execution.cycle`), "
        "мощности (`execution.capacity`), порядок приёмки (`execution.acceptance`), СМР/ПНР (`execution.smr`) "
        "и сборку файла плана работ. Чужие заключения не пиши."
    ),
    "legal": (
        "Ты помогаешь юридической службе (owner_role=legal). Отвечаешь за юридическое заключение по договору "
        "(`contract`: `sanctions` — санкции и неустойки, `warranty` — гарантия, `liability` — предел ответственности, "
        "`termination` — односторонний отказ) и сверку пунктов B22, B24–B27, B29. Цену и бюджет не утверждай."
    ),
    "it": (
        "Ты помогаешь ИТ и администраторам (owner_role=it). Смотришь журнал аудита, статус интеграций "
        "(1С ERP, TurboProject, CRM, ЭДО), полноту паспорта этапов и очередь блокировок. Бизнес-решения не подтверждай."
    ),
}

PATH_AHEAD: dict[str, str] = {
    "ks": "Комплектование, расчёт, выпуск ТКП, договор, отгрузка и оплата. После комплекта ведут служба развития и Комитет.",
    "development": "Маршрут и комплект исходных данных, затем готовность к Комитету. Дальше решение принимает Комитет.",
    "rp": "Расчёт, план, проектный и производственный запуск, приёмка и закрытие. План утверждаешь ты, стадию не переводи сам.",
    "committee": "Пакет заключений, решение, протокол и базовая версия. После решения ТКП выпускает коммерческая служба.",
    "kb": "Состав и конструкторская документация до Комитета, затем подтверждение состава до производственного запуска.",
    "omto": "Цены и сроки до Комитета, обеспечение критических позиций до запуска, комплектность до отгрузки.",
    "finance": "МЦР, маржа, резерв и БДДС до Комитета, график платежей до подписания, факт оплаты до закрытия.",
    "production": (
        "Собери файл плана работ по договору: этапы и условия договора. "
        "Дальше цикл и мощности до Комитета, затем производственный запуск, ПСИ и приёмка."
    ),
    "legal": "Сверка договора, санкции и гарантия до подписания. После подписи путь ведёт руководитель проекта.",
    "it": "Журнал, интеграции и ошибки по ходу всего пути. Следующий бизнес-шаг называй, но не подтверждай его.",
}


def service_roles() -> list[str]:
    return [role for role in ROLES if role in SERVICE_FOCUS]


def title_for(role: str) -> str:
    return f"ИИ-агент внешнего заказа · {ROLES[role]}"


def _read_step(role: str) -> str:
    if role == "production":
        return (
            "1. Сначала вызови `external_order.case(action=\"auto_prepare\", order_id=..., role=\"production\")` "
            "(или `action=read` / `action=read_full`).\n"
            "2. Затем вызови `external_order.case(action=\"plan\", order_id=...)` (один раз external_order.case action=plan). "
            "Это файл плана работ: этапы и обязательные условия договора "
            "(предмет, состав, количество, цена, НДС, сроки, оплата, комплектность, приёмка, гарантия). "
            "Общий шаблон на сетевом диске не меняй.\n"
            "3. Запиши черновики полей производства (`technical.quality`, `technical.psi`, `execution.cycle`, "
            "`execution.capacity`, `execution.acceptance`, `execution.smr`) и доказательств чек-листа через `action=propose`.\n"
            "4. В ответе назови имя файла плана из summary и проведи интерактивный опрос сотрудника по оставшимся вопросам."
        )
    return (
        f"1. Сначала вызови `external_order.case(action=\"auto_prepare\", order_id=..., role=\"{role}\")` "
        "(при необходимости деталей документов — `action=\"read_full\"`).\n"
        f"2. Всё, что удалось определить из документов дела, 1С или ответов сотрудника, запиши черновиками "
        f"через `external_order.case(action=\"propose\", section_proposals=..., check_proposals=..., diffs=...)` "
        f"или `external_order.case(action=\"draft_1c\", ...)` для роли `{role}`.\n"
        f"3. По оставшимся незаполненным полям (`questions`) и открытым пунктам чек-листа проведи интерактивный опрос сотрудника: "
        f"перечисли, какие черновики уже готовы к принятию в карточке, и задай конкретные вопросы по пробелам."
    )


def _opening(role: str) -> str:
    label = ROLES[role]
    if role == "production":
        return (
            f"Ты — профильный ИИ-помощник службы «{label}» (owner_role={role}). "
            "План работ собирается по договору на любой стадии."
        )
    return (
        f"Ты — профильный ИИ-помощник службы «{label}» (owner_role={role}). "
        "Помоги сотруднику подготовить черновики разделов, закрыть чек-лист этапа и собрать недостающие данные."
    )


def _answer_step(role: str) -> str:
    label = ROLES[role]
    if role == "production":
        return (
            f"Структура ответа для службы «{label}» (owner_role={role}): "
            "имя собранного файла плана из summary, что заполнено по условиям договора, "
            "какие черновики полей/чек-листов подготовлены и какие вопросы нужно уточнить у сотрудника."
        )
    return (
        f"Структура ответа для службы «{label}» (owner_role={role}): "
        "диагностика текущего этапа, список подготовленных черновиков (доступных по кнопке «Принять» в карточке) "
        "и конкретные вопросы к сотруднику по незаполненным полям и пунктам чек-листа."
    )


def _instructions(role: str) -> str:
    focus = SERVICE_FOCUS[role]
    return f"""{_opening(role)}

{_read_step(role)}
{_answer_step(role)}

{focus}
Ты готовишь черновик. Ты не подписываешь договор, не утверждаешь цену, бюджет, техническое решение, риск и не переводишь стадию.
Дальнейший путь этой службы: {PATH_AHEAD[role]}
Черновик не называй фактом.
"""


def playbook(role: str) -> dict:
    label = ROLES[role]
    return {
        "name": title_for(role),
        "goal": f"Помочь службе «{label}» закрыть свою часть внешнего заказа черновиком. Решение принимает человек.",
        "instructions": _instructions(role).strip(),
        "example_run": f"Открой заказ, выполни авто-подготовку для службы «{label}», сохрани черновики полей и задай вопросы по пробелам.",
        "steps": [
            {
                "id": "s1",
                "title": "Авто-подготовка и сборка плана работ" if role == "production" else "Авто-подготовка дела и черновиков службы",
                "tool": "external_order.case",
                "action": (
                    "Вызвать action=auto_prepare, затем один action=plan и action=propose. В ответе имя файла из summary."
                    if role == "production"
                    else f"Вызвать action=auto_prepare (role={role}), сохранить черновики через action=propose и опросить сотрудника по пробелам."
                ),
            },
        ],
        "tools": TOOLS,
        "model_params": MODEL_PARAMS,
    }


def stamp_active(local: dict, role: str) -> None:
    local["playbook"] = playbook(role)
    local["published"] = True
    local["status"] = "active"
    local["purpose"] = "functional"
    local["tools"] = TOOLS
    local.pop("paused", None)
    local.pop("run_on_server", None)
    local.pop("library_source_id", None)


def _owner(db: Session) -> AppUser | None:
    rows = db.query(AppUser).all()
    return next((item for item in rows if is_zhalybin(item.fio or "")), None)


def _existing(db: Session, title: str) -> Workflow | None:
    rows = db.query(Workflow).filter(Workflow.title == title, Workflow.phase == "done").all()
    for row in rows:
        if workflow_is_deleted(row):
            continue
        local = row.local_run if isinstance(row.local_run, dict) else {}
        if local.get("library_source_id"):
            continue
        return row
    return None


def _apply(row: Workflow, role: str) -> None:
    local = dict(row.local_run or {})
    stamp_active(local, role)
    row.local_run = local
    plan = dict(row.plan_json or {})
    plan["title"] = title_for(role)
    plan["goal"] = playbook(role)["goal"]
    runtime = dict(plan.get("runtime") or {})
    runtime["tools"] = TOOLS
    plan["runtime"] = runtime
    row.plan_json = plan
    row.phase = "done"
    row.notes = str(plan["goal"])
    flag_modified(row, "local_run")
    flag_modified(row, "plan_json")


def ensure_agent(db: Session, role: str) -> Workflow | None:
    if role not in SERVICE_FOCUS:
        return None
    title = title_for(role)
    row = _existing(db, title)
    if row is None:
        owner = _owner(db)
        if owner is None:
            return None
        row = Workflow(id=str(uuid4()), user_id=owner.id, title=title, phase="done", notes=playbook(role)["goal"])
        db.add(row)
    _apply(row, role)
    db.commit()
    db.refresh(row)
    return row


def ensure_agents(db: Session) -> list[Workflow]:
    from app.services.external_order_agent import ensure_agent as ensure_order
    from app.services.external_purchase_agent import ensure_agent as ensure_purchase

    ensure_order(db)
    ensure_purchase(db)
    rows: list[Workflow] = []
    for role in service_roles():
        row = ensure_agent(db, role)
        if row is not None:
            rows.append(row)
    return rows


def is_active(row: Workflow) -> bool:
    local = row.local_run if isinstance(row.local_run, dict) else {}
    return not bool(local.get("paused")) and str(local.get("status") or "") == "active"


def catalog(kind: str) -> dict:
    """Те же ответы, что у GET /agent, /purchase-agent и /service-agents.

    Старый gateway не знает эти адреса и отвечает «Заказ не найден», как будто
    это номер заказа. Окно тогда читает каталог из общей базы само.
    """
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        if kind == "agent":
            from app.services.external_order_agent import TITLE, ensure_agent

            row = ensure_agent(db)
            if row is None:
                return {"workflow_id": "", "title": TITLE}
            return {"workflow_id": row.id, "title": row.title}
        if kind == "purchase":
            from app.services.external_purchase_agent import TITLE, ensure_agent

            row = ensure_agent(db)
            if row is None:
                return {"workflow_id": "", "title": TITLE}
            return {"workflow_id": row.id, "title": row.title}
        if kind == "service":
            rows = {row.title: row for row in ensure_agents(db)}
            agents = []
            for role in service_roles():
                row = rows.get(title_for(role))
                agents.append(
                    {
                        "role": role,
                        "workflow_id": row.id if row is not None else "",
                        "title": row.title if row is not None else title_for(role),
                        "active": bool(row is not None and is_active(row)),
                    }
                )
            return {"agents": agents}
        raise ValueError(kind)
    finally:
        db.close()
