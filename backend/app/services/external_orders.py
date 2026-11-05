"""Правила внешнего заказа: роли, блокировки, карточка. Агент пишет только черновики."""

from __future__ import annotations

import base64
import json
import re
import threading
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.external_order import (
    ExternalOrder,
    ExternalOrderAudit,
    ExternalOrderCheck,
    ExternalOrderDecision,
    ExternalOrderDiff,
    ExternalOrderDocument,
    ExternalOrderFinding,
    ExternalOrderLine,
    ExternalOrderRisk,
)
from app.services.external_order_ai import is_ai_finding

ROLES: dict[str, str] = {
    "ks": "Коммерческая служба",
    "development": "Служба развития",
    "rp": "Руководитель проекта",
    "committee": "Комитет",
    "kb": "КБ и ГСПП",
    "omto": "ОМТО",
    "finance": "ОЦОиЭП и финансы",
    "production": "Производство, качество и сервис",
    "legal": "Юридическая служба",
    "it": "ИТ и администраторы",
    "viewer": "Только просмотр",
}

STAGES: dict[str, str] = {
    "request": "Запрос",
    "calc": "Расчёт",
    "tkp": "ТКП",
    "contract": "Договор",
    "plan": "Планирование",
    "execution": "Исполнение",
    "acceptance": "Приёмка и отгрузка",
    "payment": "Оплата и закрытие",
}

STATUSES: dict[str, str] = {
    "draft": "Черновик запроса",
    "collecting": "На комплектовании",
    "calculating": "На расчёте",
    "ready_committee": "Готово к Комитету",
    "rework": "На доработке",
    "confirmed": "Подтверждено",
    "confirmed_conditions": "Подтверждено с условиями",
    "tkp_issued": "ТКП выпущено",
    "contract_review": "Договор на согласовании",
    "contract_signed": "Договор подписан",
    "in_progress": "В исполнении",
    "production": "Производственный запуск",
    "acceptance": "Приёмка и отгрузка",
    "shipped": "Отгрузка",
    "awaiting_payment": "Ожидание оплаты",
    "closed": "Закрыт",
}

CHECK_STATUSES = {
    "not_applicable": "Не применимо",
    "not_started": "Не начато",
    "open": "Не начато",
    "in_progress": "В работе",
    "review": "Требует проверки",
    "done": "Выполнено",
    "overdue": "Просрочено",
    "blocked": "Заблокировано",
}

ROUTES = {
    "full": "Полный",
    "accelerated": "Ускоренный",
    "simplified": "Упрощённый",
    "recalc": "Пересчёт",
}

# Несерийный путь сверху вниз, без согласования руководства.
# form — открытие списка в толстом клиенте 1С, file — шаблон на диске.
PROJECT_PLAN_TEMPLATE = (
    r"\\192.168.1.198\project\1. ПУЛ, СТО, Шаблоны документов, Инструкции"
    r"\Шаблон плана без РУКОВОДСТВА.mpp"
)
ZPR_FORM = "Документ.ТД_ЗаявкаОПотребностиРынка.Форма.ФормаСписка"
ORDER_CARD_FORM = "ЖурналДокументов.ТД_ЖурналКартЗаказа.Форма.ФормаСписка"
CUSTOMER_ORDER_FORM = "Документ.ЗаказКлиента.Форма.ФормаСпискаДокументов"
START_ORDER_FORM = "Документ.ТД_РаспоряжениеОНачалеПроекта.ФормаСписка"
CRM_PROJECT_FORM = "Справочник.Проекты.Форма.CRM_ФормаСписка"

SIMPLIFIED_PATH: list[dict[str, str]] = [
    {
        "id": "zpr",
        "title": "ЗПР",
        "detail": "Заявка о потребности рынка",
        "form": ZPR_FORM,
        "file": "",
        "prompt": (
            "Прочитай заявку о потребности рынка в деле. Собери исходные данные: "
            "заказчик, изделие, количество, срок и чего не хватает. Это черновик, стадию не переводи."
        ),
    },
    {
        "id": "tech",
        "title": "Техническая проверка",
        "detail": "Службы СР, ГКИ и ГСПП",
        "form": ZPR_FORM,
        "file": "",
        "prompt": (
            "Проверь реализуемость проекта для служб СР, ГКИ и ГСПП. "
            "Напиши, чего не хватает каждой службе и можно ли брать заказ в работу. "
            "Вывод только черновик, решение служб не подменяй и стадию не переводи."
        ),
    },
    {
        "id": "analysis",
        "title": "Анализ ЗПР",
        "detail": "Служба развития",
        "form": ZPR_FORM,
        "file": "",
        "prompt": (
            "Подготовь анализ заявки о потребности рынка для службы развития: "
            "маршрут, нестандартные решения и пробелы исходных данных. Стадию не переводи."
        ),
    },
    {
        "id": "committee",
        "title": "Комитет",
        "detail": "Комитет по расчету стоимости внешних несерийных заказов",
        "form": "",
        "file": "",
        "prompt": (
            "Собери черновик протокола совещания «Комитет по расчету стоимости внешних несерийных заказов»: "
            "решения и задачи с исполнителями. Протокол не утверждай и в 1С сам не отправляй."
        ),
    },
    {
        "id": "passport",
        "title": "Паспорт",
        "detail": "Журнал карт заказа",
        "form": ORDER_CARD_FORM,
        "file": "",
        "prompt": (
            "Проверь полноту паспорта заказа по делу и карте заказа. "
            "Перечисли пустые поля и кто должен их закрыть. Паспорт сам не заполняй."
        ),
    },
    {
        "id": "tkp",
        "title": "ТКП",
        "detail": "Черновик технико-коммерческого предложения",
        "form": "",
        "file": "",
        "prompt": (
            "Составь черновик технико-коммерческого предложения по полям дела и условиям протокола. "
            "ТКП не выпускай: это делает человек."
        ),
    },
    {
        "id": "contract",
        "title": "Договор и спецификация",
        "detail": "Заказ клиента",
        "form": CUSTOMER_ORDER_FORM,
        "file": "",
        "prompt": (
            "Перенеси условия ТКП в состав спецификации заказа клиента: предмет, количество, цена, срок, "
            "оплата и комплектность. Договор не подписывай."
        ),
    },
    {
        "id": "linked",
        "title": "Связанные документы",
        "detail": "Всё ведётся от заказа клиента",
        "form": CUSTOMER_ORDER_FORM,
        "file": "",
        "prompt": (
            "Сверь, что дальнейшие документы дела привязаны к заказу клиента. "
            "Назови, какого связанного документа не хватает. Сам документы не создавай."
        ),
    },
    {
        "id": "start",
        "title": "Распоряжение",
        "detail": "Начальник цеха несерийного оборудования",
        "form": START_ORDER_FORM,
        "file": "",
        "prompt": (
            "Подготовь текст распоряжения о начале проекта для начальника цеха несерийного оборудования: "
            "что запускать, срок и какие условия договора уже обязательны. Распоряжение не проводи."
        ),
    },
    {
        "id": "plan",
        "title": "План проекта",
        "detail": "Шаблон плана без руководства",
        "form": CRM_PROJECT_FORM,
        "file": PROJECT_PLAN_TEMPLATE,
        "prompt": (
            "Проверь план работ инструментом: external_order.case action=plan_preview. План текстом не пиши. "
            "Спроси только по вопросам плана: сроки по нормативу, пустые условия договора, задачи без службы, выход за срок. "
            "Ответы передай как overrides и один раз вызови action=plan. Даты, цены, НДС и сроки не выдумывай: "
            "чего нет — «в деле нет». Общий шаблон «Шаблон плана без РУКОВОДСТВА.mpp» на диске не перезаписывай. "
            "Итог в 3–5 строк: что взято из дела, чего нет, имя файла; .mpp собирается кнопкой «Собрать .mpp»."
        ),
    },
]

DESKS: dict[str, dict] = {
    "ks": {
        "title": "Рабочий стол коммерческой службы",
        "sees": ["Новые запросы", "Комплектность", "ТКП", "Договоры на сверке", "Вопросы заказчику"],
        "denied": ["Технические, финансовые и юридические заключения"],
    },
    "development": {
        "title": "Рабочий стол службы развития",
        "sees": ["Маршрут", "Нестандартные решения", "Комплект исходных данных"],
        "denied": ["Утверждение цены и договора"],
    },
    "rp": {
        "title": "Рабочий стол руководителя проекта",
        "sees": ["Портфель", "Критический путь", "Риски", "Изменения", "Предложение закрытия"],
        "denied": ["Цена", "Платёжный факт", "Юридическое решение"],
    },
    "committee": {
        "title": "Панель Комитета",
        "sees": ["Готовность пакета", "Заключения", "Решение", "Условия", "Протокол", "Базовая версия"],
        "denied": ["Удаление истории"],
    },
    "kb": {
        "title": "Заключения КБ и ГСПП",
        "sees": ["Состав", "КД", "Аналоги", "Ограничения"],
        "denied": ["Чужие заключения"],
    },
    "omto": {
        "title": "Заключения ОМТО",
        "sees": ["Цены и сроки поставки", "Критические позиции", "Логистика"],
        "denied": ["Чужие заключения"],
    },
    "finance": {
        "title": "Финансы и ОЦОиЭП",
        "sees": ["МЦР", "Себестоимость", "Маржа", "Резерв", "БДДС", "План платежей", "Факт оплаты из 1С"],
        "denied": ["Ручная правка факта оплаты"],
    },
    "production": {
        "title": "Производство, качество и сервис",
        "sees": ["Цикл и мощности", "ПСИ", "Приёмка", "СМР и ПНР"],
        "denied": ["Чужие заключения"],
    },
    "legal": {
        "title": "Юридическая служба",
        "sees": ["Расхождения договора", "Санкции", "Гарантия"],
        "denied": ["Цена и бюджет"],
    },
    "it": {
        "title": "Администрирование",
        "sees": ["Журнал аудита", "Статус интеграций", "Очередь ошибок"],
        "denied": ["Подтверждение бизнес-решений"],
    },
    "viewer": {
        "title": "Реестр",
        "sees": ["Карточки только для чтения"],
        "denied": ["Изменение заказа"],
    },
}

_CHECKS: list[tuple[str, str, str]] = [
    ("before_calc", "Запрос и ТЗ зарегистрированы", "ks"),
    ("before_calc", "Заказчик и продукт идентифицированы", "ks"),
    ("before_calc", "Количество, срок, место и границы работ определены", "ks"),
    ("before_calc", "Назначены КС и РП", "development"),
    ("before_calc", "Выбран маршрут", "development"),
    ("before_committee", "Состав и КД определены", "kb"),
    ("before_committee", "Цены и сроки закупок актуальны", "omto"),
    ("before_committee", "Производство подтвердило цикл и мощности", "production"),
    ("before_committee", "Рассчитаны МЦР, маржа, резерв и БДДС", "finance"),
    ("before_committee", "Сформированы график, риски и заключения", "rp"),
    ("before_tkp", "Есть разрешающий протокол и базовая версия", "committee"),
    ("before_tkp", "ТКП соответствует базе и условиям протокола", "ks"),
    ("before_tkp", "Срок действия исходных цен не истёк", "omto"),
    ("before_sign", "Выполнена сверка ТКП, договора и спецификаций", "ks"),
    ("before_sign", "Закрыты блокирующие расхождения", "ks"),
    ("before_sign", "Договорные даты отражены в плане", "rp"),
    ("before_sign", "Юристы подтвердили свою область", "legal"),
    ("before_sign", "Финансы подтвердили свою область", "finance"),
    ("before_sign", "РП подтвердил свою область", "rp"),
    ("before_sign", "КС подтвердила свою область", "ks"),
    ("before_sign", "Подписная версия идентична согласованной", "ks"),
    ("before_project", "Договор подписан или есть документированное основание", "ks"),
    ("before_project", "Назначены роли", "rp"),
    ("before_project", "План и бюджет утверждены", "rp"),
    ("before_project", "Условия запуска и финансирования выполнены", "finance"),
    ("before_project", "Создано электронное дело", "ks"),
    ("before_production", "КД и состав подтверждены", "kb"),
    ("before_production", "Закупки и критические позиции обеспечены", "omto"),
    ("before_production", "Ресурсы и мощности подтверждены", "production"),
    ("before_production", "Маршрут и контроль качества определены", "production"),
    ("before_production", "Незакрытые условия не затрагивают запуск", "committee"),
    ("before_psi", "Программа и методика утверждены", "production"),
    ("before_psi", "Готовность изделия подтверждена", "production"),
    ("before_psi", "Средства измерений действительны", "production"),
    ("before_psi", "Заказчик уведомлён", "ks"),
    ("before_psi", "Комплект документов подготовлен", "ks"),
    ("before_psi", "Замечания предыдущих проверок закрыты", "production"),
    ("before_ship", "Приёмка завершена", "production"),
    ("before_ship", "Комплектность, упаковка и маркировка подтверждены", "omto"),
    ("before_ship", "Документы готовы", "ks"),
    ("before_ship", "Условия оплаты и отгрузки выполнены", "finance"),
    ("before_ship", "Логистика согласована", "omto"),
    ("before_close", "Обязательства и замечания закрыты", "rp"),
    ("before_close", "Документы архивированы", "ks"),
    ("before_close", "Претензии урегулированы", "legal"),
    ("before_close", "Гарантийная передача выполнена", "production"),
    ("before_close", "Получено 100 процентов оплаты", "finance"),
    ("before_close", "Сформированы уроки проекта", "rp"),
]

_DIFFS: list[tuple[str, str, str, str, str]] = [
    ("B01", "Идентификация", "Стороны, реквизиты, номер и дата", "ks", "material"),
    ("B02", "Предмет", "Формулировка предмета и границы поставки", "ks", "blocking"),
    ("B03", "Состав", "Номенклатура, исполнения, комплектность", "kb", "blocking"),
    ("B04", "Количество", "Количество и единицы по строкам", "ks", "blocking"),
    ("B05", "Цена", "Цена строки и итоговая цена", "finance", "blocking"),
    ("B06", "НДС", "Ставка и включение в цену", "finance", "blocking"),
    ("B07", "Валюта", "Валюта цены и платежа", "finance", "blocking"),
    ("B08", "Индексация", "Формула изменения цены", "finance", "material"),
    ("B09", "Срок поставки", "Дата и начало отсчёта", "rp", "blocking"),
    ("B10", "Этапы", "Промежуточные сроки", "rp", "material"),
    ("B11", "Место поставки", "Адрес и базис", "ks", "material"),
    ("B12", "Логистика", "Транспорт, упаковка, страхование", "omto", "material"),
    ("B13", "Оплата", "Аванс, постоплата, этапы", "finance", "blocking"),
    ("B14", "Документы для оплаты", "Счёт, акт, УПД", "finance", "material"),
    ("B15", "Удержания", "Размер и условия возврата", "finance", "blocking"),
    ("B16", "Обеспечения", "Гарантии и лимиты", "finance", "material"),
    ("B17", "Приёмка", "Порядок, сроки, критерии", "production", "blocking"),
    ("B18", "ПСИ", "Программа и результат", "production", "blocking"),
    ("B19", "Документация", "Паспорт, РЭ, сертификаты", "kb", "material"),
    ("B20", "СМР и ПНР", "Состав и условия площадки", "rp", "blocking"),
    ("B21", "Обучение", "Программа и участники", "rp", "material"),
    ("B22", "Гарантия", "Срок и объём", "legal", "blocking"),
    ("B23", "Сервис", "Срок реакции и запчасти", "production", "material"),
    ("B24", "Ответственность", "Неустойки и предел", "legal", "blocking"),
    ("B25", "Односторонний отказ", "Основания и уведомление", "legal", "blocking"),
    ("B26", "Изменение договора", "Порядок согласования", "legal", "material"),
    ("B27", "Конфиденциальность", "Состав данных и срок", "legal", "material"),
    ("B28", "Качество", "Нормативы и безопасность", "production", "blocking"),
    ("B29", "Интеллектуальные права", "КД, ПО, лицензии", "legal", "material"),
    ("B30", "Приложения", "Номера, даты, версии", "ks", "blocking"),
    ("B31", "Расчётная база", "МЦР, себестоимость, маржа", "finance", "blocking"),
    ("B32", "БДДС", "График оплаты и кассовый разрыв", "finance", "blocking"),
    ("B33", "План", "Обязательства связаны с вехами", "rp", "blocking"),
    ("B34", "Решение Комитета", "Договор соответствует протоколу", "committee", "blocking"),
    ("B35", "Подписная версия", "Файл совпадает с согласованной версией", "ks", "blocking"),
]

SECTION_WRITERS = {
    "commercial": {"ks"},
    "technical": {"kb", "production"},
    "calculation": {"finance"},
    "contract": {"ks", "legal"},
    "project": {"rp"},
    "execution": {"rp", "production"},
    "finance": {"finance"},
    "closure": {"rp"},
}
LEGAL_KEYS = {"sanctions", "warranty", "liability", "termination"}
PRICE_KEYS = {"price", "vat", "currency", "discount"}
BUDGET_KEYS = {"margin", "cost", "reserve", "bdds", "mcr"}

TRANSITION_ROLES = {
    "collecting": {"ks", "development"},
    "calculating": {"ks", "development", "rp"},
    "ready_committee": {"development", "committee"},
    "rework": {"committee"},
    "tkp_issued": {"ks"},
    "contract_review": {"ks"},
    "contract_signed": {"ks"},
    "in_progress": {"rp"},
    "production": {"rp", "production"},
    "acceptance": {"rp", "production"},
    "shipped": {"rp", "ks"},
    "awaiting_payment": {"finance", "ks"},
    "closed": {"rp"},
}

# Откуда допустим переход. Подтверждение и доработку ставит решение Комитета.
TRANSITION_FROM = {
    "collecting": {"draft", "calculating", "rework"},
    "calculating": {"draft", "collecting", "rework", "ready_committee", "confirmed", "confirmed_conditions"},
    "ready_committee": {"calculating", "rework"},
    "rework": {"ready_committee"},
    "tkp_issued": {"confirmed", "confirmed_conditions"},
    "contract_review": {"tkp_issued"},
    "contract_signed": {"contract_review"},
    "in_progress": {"contract_signed"},
    "production": {"in_progress"},
    "acceptance": {"in_progress", "production"},
    "shipped": {"acceptance"},
    "awaiting_payment": {"acceptance", "shipped"},
    "closed": {"awaiting_payment"},
}

# Какой переход ждёт заказ в этом статусе: его блокировку видно в карточке заранее.
NEXT_GATE = {
    "draft": "ready_committee",
    "collecting": "ready_committee",
    "calculating": "ready_committee",
    "rework": "ready_committee",
    "ready_committee": "tkp_issued",
    "confirmed": "tkp_issued",
    "confirmed_conditions": "tkp_issued",
    "tkp_issued": "contract_signed",
    "contract_review": "contract_signed",
    "contract_signed": "in_progress",
    "in_progress": "production",
    "production": "shipped",
    "acceptance": "shipped",
    "shipped": "closed",
    "awaiting_payment": "closed",
}

STATUS_STAGE = {
    "draft": "request",
    "collecting": "request",
    "calculating": "calc",
    "ready_committee": "calc",
    "rework": "calc",
    "confirmed": "calc",
    "confirmed_conditions": "calc",
    "tkp_issued": "tkp",
    "contract_review": "contract",
    "contract_signed": "contract",
    "in_progress": "execution",
    "production": "execution",
    "acceptance": "acceptance",
    "shipped": "acceptance",
    "awaiting_payment": "payment",
    "closed": "payment",
}

_LINK_ROLES = {"ks", "development", "finance", "it"}


def settings_ready() -> bool:
    from app.config import settings

    return bool((settings.turboproject_api_base or "").strip() and (settings.turboproject_email or "").strip())


def integrations() -> list[dict[str, str]]:
    from app.services.external_order_onec import connection_label

    state, note = connection_label()
    return [
        {"system": "1С ERP", "state": state, "note": note},
        {
            "system": "TurboProject",
            "state": "подключено" if (settings_ready()) else "не настроено",
            "note": (
                "Портфель читается для стратегических сроков. "
                "Запись задач в файл проекта API не выполняет."
                if settings_ready()
                else "В backend нет адреса или учётной записи TurboProject."
            ),
        },
        {
            "system": "CRM",
            "state": state if state == "подключено" else "не настроено",
            "note": "Сделка с клиентом читается из 1С вместе с коммерческим предложением.",
        },
        {"system": "ЭДО", "state": "не подключено", "note": "Подписанная версия прикладывается как документ дела."},
    ]


class ExternalOrderError(Exception):
    def __init__(self, detail: str, status: int = 400) -> None:
        self.detail = detail
        self.status = status


def _fio_has(fio: str, *tokens: str) -> bool:
    folded = (fio or "").casefold().replace("ё", "е")
    return all(token in folded for token in tokens)


def is_zhalybin(fio: str) -> bool:
    return _fio_has(fio, "жалыбин", "максим", "дмитриевич")


def can_test_external_order(fio: str, position: str = "", department: str = "") -> bool:
    """Просмотр всех ролей и переключение для проверки. Владелец агента по-прежнему Жалыбин."""
    if is_zhalybin(fio) or _fio_has(fio, "рамазанов", "роман"):
        return True
    job = f"{position} {department}".casefold().replace("ё", "е")
    return "тестировщик" in job


def testing_profile(
    *,
    fio: str,
    position: str,
    department: str,
    stored_fio: str = "",
    stored_position: str = "",
    stored_department: str = "",
) -> tuple[str, str, str]:
    """Берёт карточку из базы, если в токене ФИО короче, чем в users."""
    stored = (stored_fio or "", stored_position or "", stored_department or "")
    token = (fio or "", position or "", department or "")
    for item in (stored, token):
        if can_test_external_order(*item):
            return item
    return stored if any(stored) else token


testing_profile.__test__ = False  # type: ignore[attr-defined]


def is_shared_external_order_agent(title: str) -> bool:
    """Агенты внешнего заказа общие для проверки: читает тестировщик, правит только владелец."""
    text = (title or "").casefold().replace("ё", "е")
    return text.startswith("ии-агент внешнего заказа") or text.startswith("ии-агент внешних закупок")


def _software_quality(text: str) -> bool:
    """Сектор качества разработки — это тестирование, не производство."""
    return "тестировщик" in text or ("качеств" in text and "разработ" in text)


def role_from_profile(position: str, department: str) -> str:
    text = f"{position} {department}".casefold().replace("ё", "е")
    if _software_quality(text):
        return "viewer"
    if "юрист" in text or "правов" in text:
        return "legal"
    if "омто" in text or "снабжен" in text or "логист" in text:
        return "omto"
    if any(token in text for token in ("финанс", "экономист", "оцо", "бддс")):
        return "finance"
    if any(token in text for token in ("конструктор", "гспп")) or " кб" in f" {text}":
        return "kb"
    if "комитет" in text:
        return "committee"
    if "руководитель проекта" in text or "проектн" in text:
        return "rp"
    if "развит" in text:
        return "development"
    if "коммерч" in text or "продаж" in text:
        return "ks"
    if any(token in text for token in ("производ", "сервис")) or (
        "качеств" in text and "разработ" not in text
    ):
        return "production"
    if "администратор" in text or text.strip() in {"ит", "it"} or "информацион" in text:
        return "it"
    return "viewer"


def resolve_role(*, fio: str, position: str, department: str, as_role: str) -> str:
    asked = (as_role or "").strip()
    if can_test_external_order(fio, position, department):
        if asked in ROLES and asked != "viewer":
            return asked
        # Тот же стол, что у проверяющего: ИТ видит журнал, загрузку из 1С и все кнопки.
        return "it"
    return role_from_profile(position, department)


def meta_for(*, fio: str, position: str, department: str, as_role: str) -> dict:
    role = resolve_role(fio=fio, position=position, department=department, as_role=as_role)
    return {
        "role": role,
        "role_label": ROLES[role],
        "can_switch": can_test_external_order(fio, position, department),
        "roles": [{"id": key, "label": label} for key, label in ROLES.items() if key != "viewer"],
        "desk": DESKS[role],
        "stages": [{"id": key, "label": label} for key, label in STAGES.items()],
        "statuses": [{"id": key, "label": label} for key, label in STATUSES.items()],
        "routes": [{"id": key, "label": label} for key, label in ROUTES.items()],
        "simplified_path": SIMPLIFIED_PATH,
        "integrations": integrations(),
    }


def _load(raw: str) -> dict:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _dump(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False)


def _new_id() -> str:
    return uuid4().hex


def _audit(
    db: Session,
    order: ExternalOrder,
    *,
    fio: str,
    role: str,
    action: str,
    detail: str,
    before: str = "",
    after: str = "",
) -> None:
    db.add(
        ExternalOrderAudit(
            id=_new_id(),
            order_id=order.id,
            actor_fio=fio,
            actor_role=role,
            action=action,
            detail=detail,
            before_value=before,
            after_value=after,
        )
    )


def _require_business(role: str) -> None:
    if role == "it":
        raise ExternalOrderError("ИТ не подтверждает бизнес-решения", 403)
    if role == "viewer":
        raise ExternalOrderError("Для этой должности заказ только для чтения", 403)


def _require_owner(role: str, owner: str, what: str) -> None:
    _require_business(role)
    if role != owner:
        raise ExternalOrderError(f"Нельзя подтвердить {what} чужой роли", 403)


def _order(db: Session, order_id: str) -> ExternalOrder:
    key = (order_id or "").strip()
    row = db.get(ExternalOrder, key) if key else None
    if row is None and key:
        row = db.query(ExternalOrder).filter(ExternalOrder.code == key).one_or_none()
    if row is None:
        raise ExternalOrderError("Заказ не найден", 404)
    return row


def _tkp_block(decisions: list[ExternalOrderDecision]) -> str | None:
    ready = [
        item
        for item in decisions
        if item.decision in {"confirmed", "confirmed_conditions"}
        and item.protocol.strip()
        and item.base_version.strip()
    ]
    if not ready:
        return "Финальное ТКП заблокировано: нет протокола Комитета и базовой версии"
    if not any(item.decision == "confirmed" or item.conditions_closed for item in ready):
        return "Финальное ТКП заблокировано: условия протокола не закрыты"
    return None


def _recorded_mismatch(item: ExternalOrderDiff) -> bool:
    """Расхождение есть только если сверка уже заполнена и стороны не совпали. Пустая строка B01–B35 — ещё не сверка."""
    if item.level != "blocking" or item.status == "closed":
        return False
    left = str(item.left_value or "").strip()
    right = str(item.right_value or "").strip()
    if not left or not right:
        return False
    return left.casefold() != right.casefold()


def _sign_block(order: ExternalOrder) -> str | None:
    from app.services.external_order_case import open_gate

    if any(_recorded_mismatch(item) for item in order.diffs):
        return "Подписание заблокировано: есть блокирующее расхождение"
    text = open_gate(order, {"before_sign"})
    if text:
        return f"Подписание заблокировано: нет согласования «{text}»"
    return None


def _close_block(order: ExternalOrder) -> str | None:
    from app.services.external_order_case import open_gate

    if order.payment_percent < 100:
        return "Закрытие заблокировано: нет 100% оплаты"
    text = open_gate(order, {"before_close"})
    if text:
        return f"Закрытие заблокировано: {text}"
    return None


def _onec_link(order: ExternalOrder) -> dict:
    link = _load(order.sections_json).get("onec")
    return link if isinstance(link, dict) else {}


def _onec_number(order: ExternalOrder) -> str:
    return str(_onec_link(order).get("order_number") or "").strip()


def _onec_key(order: ExternalOrder) -> str:
    return str(_onec_link(order).get("order_key") or "").strip()


def _path_label(order: ExternalOrder) -> str:
    raw = _onec_link(order).get("path") or ""
    try:
        steps = json.loads(raw) if isinstance(raw, str) and raw else []
    except json.JSONDecodeError:
        steps = []
    parts: list[str] = []
    if isinstance(steps, list):
        for step in steps:
            if not isinstance(step, dict) or step.get("state") in {"waiting", "skip"}:
                continue
            detail = str(step.get("detail") or "").split(" · ")[0].strip()
            title = str(step.get("title") or "").strip()
            if title and detail:
                parts.append(f"{title}: {detail}")
    if parts:
        return " → ".join(parts)
    number = _onec_number(order)
    return f"Заказ {number}" if number else ""


def _payment_note(order: ExternalOrder) -> str:
    link = _load(order.sections_json).get("onec")
    if not isinstance(link, dict) or not str(link.get("order_number") or "").strip():
        return "Заказ клиента в 1С не привязан"
    return (
        f"1С заказ {link.get('order_number')}: оплачено {link.get('paid') or '0'} "
        f"из {link.get('amount') or '0'} ({order.payment_percent}%)"
    )


def blocks_for(order: ExternalOrder) -> list[str]:
    target = NEXT_GATE.get(order.status)
    reason = _block_for(order, target) if target else None
    return [reason] if reason else []


_DOC_KIND_LABELS: dict[str, str] = {
    "tz": "ТЗ",
    "tkp": "ТКП",
    "contract": "Договор",
    "specification": "Спецификация",
    "condition": "Заключение",
    "acceptance": "Приёмка",
    "protocol": "Протокол",
    "plan": "План работ",
    "survey": "Опросный лист",
    "assignment": "Поручение",
    "memo": "Служебная записка",
    "directive": "Распоряжение",
    "decree": "Приказ",
    "customer_order": "Заказ",
    "attached": "Прикреплённый файл",
    "correspondence": "Переписка",
    "other": "Документ",
}

_DRAFT_1C_LABELS: dict[str, str] = {
    "memo": "Служебная записка 1С ДО",
    "assignment": "Поручение 1С ДО",
    "directive": "Распоряжение 1С ДО",
    "order": "Приказ 1С ДО",
    "protocol": "Протокол 1С ДО",
}

_FIELD_LABELS: dict[str, str] = {
    "subject": "Предмет поставки",
    "price": "Цена",
    "vat": "НДС",
    "currency": "Валюта",
    "discount": "Скидка",
    "term": "Срок поставки",
    "payment": "Условия оплаты",
    "acceptance": "Порядок приёмки",
    "warranty": "Гарантия",
    "sanctions": "Санкции и неустойка",
    "liability": "Ответственность",
    "termination": "Односторонний отказ",
    "composition": "Состав поставки",
    "kd": "Конструкторская документация",
    "analogs": "Аналоги",
    "limits": "Ограничения",
    "quality": "Нормативы качества",
    "psi": "ПСИ",
    "cycle": "Производственный цикл",
    "capacity": "Мощности",
    "smr": "СМР и ПНР",
    "mcr": "МЦР",
    "cost": "Себестоимость",
    "margin": "Маржа",
    "reserve": "Резерв",
    "bdds": "БДДС",
    "schedule": "График платежей",
    "plan_note": "План проекта",
    "critical_path": "Критический путь",
    "status": "Ход исполнения",
    "lessons": "Уроки проекта",
    "specification": "Спецификация",
    "pdf_text": "Текст PDF",
    "новая базовая версия": "Новая базовая версия",
}

ROLE_FIELDS_SPEC: dict[str, list[dict[str, str]]] = {
    "ks": [
        {
            "section": "commercial",
            "section_title": "Коммерческие условия",
            "key": "price",
            "label": "Цена",
            "prompt": "Укажите цену заказа (с источником: ТКП или договор)",
            "placeholder": "Например: 4 500 000 руб. (ТКП v1)",
        },
        {
            "section": "commercial",
            "section_title": "Коммерческие условия",
            "key": "vat",
            "label": "НДС",
            "prompt": "Укажите ставку и порядок учёта НДС",
            "placeholder": "Например: 20%, в том числе",
        },
        {
            "section": "commercial",
            "section_title": "Коммерческие условия",
            "key": "currency",
            "label": "Валюта",
            "prompt": "Укажите валюту цены и платежа",
            "placeholder": "Например: RUB",
        },
        {
            "section": "commercial",
            "section_title": "Коммерческие условия",
            "key": "discount",
            "label": "Скидка",
            "prompt": "Укажите согласованную скидку или её отсутствие",
            "placeholder": "Например: 0% (без скидки)",
        },
    ],
    "kb": [
        {
            "section": "technical",
            "section_title": "Заключение КБ и ГСПП",
            "key": "composition",
            "label": "Состав",
            "prompt": "Подтвердите состав поставки и комплектность изделия",
            "placeholder": "Например: Расходомер, блок электроники, комплект КМЧ",
        },
        {
            "section": "technical",
            "section_title": "Заключение КБ и ГСПП",
            "key": "kd",
            "label": "Конструкторская документация",
            "prompt": "Укажите готовность КД и необходимость доработки",
            "placeholder": "Например: КД в наличии, доработка не требуется",
        },
        {
            "section": "technical",
            "section_title": "Заключение КБ и ГСПП",
            "key": "analogs",
            "label": "Аналоги",
            "prompt": "Укажите допустимость применения аналогов",
            "placeholder": "Например: Допускаются аналоги по ведомости КБ",
        },
        {
            "section": "technical",
            "section_title": "Заключение КБ и ГСПП",
            "key": "limits",
            "label": "Ограничения",
            "prompt": "Укажите технические ограничения и особые требования ТЗ",
            "placeholder": "Например: Рабочее давление до 16 МПа, исполнение УХЛ1",
        },
    ],
    "production": [
        {
            "section": "technical",
            "section_title": "Качество",
            "key": "quality",
            "label": "Нормативы",
            "prompt": "Укажите применимые нормативы качества и безопасности",
            "placeholder": "Например: ГОСТ, ТР ТС 032/2013",
        },
        {
            "section": "technical",
            "section_title": "Качество",
            "key": "psi",
            "label": "ПСИ",
            "prompt": "Укажите программу и методику ПСИ",
            "placeholder": "Например: ПСИ на стенде предприятия по типовой ПМ",
        },
        {
            "section": "execution",
            "section_title": "Производство и сервис",
            "key": "cycle",
            "label": "Цикл",
            "prompt": "Укажите длительность производственного цикла",
            "placeholder": "Например: 45 рабочих дней",
        },
        {
            "section": "execution",
            "section_title": "Производство и сервис",
            "key": "capacity",
            "label": "Мощности",
            "prompt": "Подтвердите наличие производственных мощностей",
            "placeholder": "Например: Мощности цеха подтверждены",
        },
        {
            "section": "execution",
            "section_title": "Производство и сервис",
            "key": "acceptance",
            "label": "Приёмка",
            "prompt": "Укажите порядок приёмки изделия",
            "placeholder": "Например: Приёмка ОТК, уведомление заказчика за 5 дней",
        },
        {
            "section": "execution",
            "section_title": "Производство и сервис",
            "key": "smr",
            "label": "СМР и ПНР",
            "prompt": "Укажите объём СМР и ПНР по заказу",
            "placeholder": "Например: СМР и ПНР не входят в объём поставки",
        },
    ],
    "finance": [
        {
            "section": "calculation",
            "section_title": "Расчёт",
            "key": "mcr",
            "label": "МЦР",
            "prompt": "Укажите минимальную цену реализации (МЦР)",
            "placeholder": "Например: 3 800 000 руб.",
        },
        {
            "section": "calculation",
            "section_title": "Расчёт",
            "key": "cost",
            "label": "Себестоимость",
            "prompt": "Укажите плановую себестоимость заказа",
            "placeholder": "Например: 3 200 000 руб.",
        },
        {
            "section": "calculation",
            "section_title": "Расчёт",
            "key": "margin",
            "label": "Маржа",
            "prompt": "Укажите расчётную маржинальность",
            "placeholder": "Например: 25%",
        },
        {
            "section": "calculation",
            "section_title": "Расчёт",
            "key": "reserve",
            "label": "Резерв",
            "prompt": "Укажите размер финансового резерва",
            "placeholder": "Например: 5%",
        },
        {
            "section": "calculation",
            "section_title": "Расчёт",
            "key": "bdds",
            "label": "БДДС",
            "prompt": "Укажите оценку БДДС и кассового потока",
            "placeholder": "Например: Аванс 50%, кассового разрыва нет",
        },
        {
            "section": "finance",
            "section_title": "Оплата",
            "key": "schedule",
            "label": "График платежей",
            "prompt": "Укажите согласованный график платежей",
            "placeholder": "Например: 50% аванс, 50% в течение 15 дней после отгрузки",
        },
    ],
    "legal": [
        {
            "section": "contract",
            "section_title": "Юридическое заключение",
            "key": "sanctions",
            "label": "Санкции",
            "prompt": "Укажите условия по неустойкам и штрафам в договоре",
            "placeholder": "Например: 0,1% в день, предел 5% от цены",
        },
        {
            "section": "contract",
            "section_title": "Юридическое заключение",
            "key": "warranty",
            "label": "Гарантия",
            "prompt": "Укажите гарантийный срок и объём гарантии",
            "placeholder": "Например: 24 месяца с даты отгрузки",
        },
        {
            "section": "contract",
            "section_title": "Юридическое заключение",
            "key": "liability",
            "label": "Ответственность",
            "prompt": "Укажите предел ответственности по договору",
            "placeholder": "Например: Только реальный ущерб, без упущенной выгоды",
        },
        {
            "section": "contract",
            "section_title": "Юридическое заключение",
            "key": "termination",
            "label": "Односторонний отказ",
            "prompt": "Укажите условия одностороннего отказа от договора",
            "placeholder": "Например: По соглашению сторон или с компенсацией фактических затрат",
        },
    ],
    "rp": [
        {
            "section": "project",
            "section_title": "Проект",
            "key": "plan_note",
            "label": "План",
            "prompt": "Укажите ключевые сроки и параметры базового плана",
            "placeholder": "Например: Поставка за 90 дней с момента аванса",
        },
        {
            "section": "project",
            "section_title": "Проект",
            "key": "critical_path",
            "label": "Критический путь",
            "prompt": "Укажите критический путь исполнения заказа",
            "placeholder": "Например: КД -> закупка датчиков -> сборка -> ПСИ",
        },
        {
            "section": "execution",
            "section_title": "Исполнение",
            "key": "status",
            "label": "Ход исполнения",
            "prompt": "Опишите текущий статус исполнения работ",
            "placeholder": "Например: Запущено в производство по графику",
        },
        {
            "section": "closure",
            "section_title": "Закрытие",
            "key": "lessons",
            "label": "Уроки проекта",
            "prompt": "Зафиксируйте уроки проекта для архива",
            "placeholder": "Например: Обязательства выполнены полностью, претензий нет",
        },
    ],
}

STAGE_PASSPORT_SPECS: list[dict] = [
    {
        "id": "request",
        "label": "Запрос",
        "hint": "Заказчик и продукт уже в карточке. Дальше собираем комплект.",
        "statuses": ["draft", "collecting"],
        "owner_roles": ["ks", "development"],
        "gates": ["before_calc"],
        "required_docs": ["tz"],
    },
    {
        "id": "calc",
        "label": "Расчёт",
        "hint": "Считаем цену, срок и состав. Потом заказ идёт в Комитет.",
        "statuses": ["calculating", "rework"],
        "owner_roles": ["kb", "omto", "production", "finance", "rp", "development"],
        "gates": ["before_committee"],
        "required_docs": ["tz", "specification"],
    },
    {
        "id": "committee",
        "label": "Комитет",
        "hint": "Комитет подтверждает базу или возвращает на доработку.",
        "statuses": ["ready_committee", "confirmed", "confirmed_conditions"],
        "owner_roles": ["committee", "finance", "rp"],
        "gates": ["before_tkp"],
        "required_docs": ["protocol", "condition"],
    },
    {
        "id": "tkp",
        "label": "ТКП",
        "hint": "Предложение выпущено и ушло заказчику.",
        "statuses": ["tkp_issued"],
        "owner_roles": ["ks", "omto"],
        "gates": ["before_tkp"],
        "required_docs": ["tkp", "protocol"],
    },
    {
        "id": "contract",
        "label": "Договор",
        "hint": "Сверяем ТКП с договором и ждём подпись.",
        "statuses": ["contract_review", "contract_signed"],
        "owner_roles": ["ks", "legal", "finance", "rp"],
        "gates": ["before_sign"],
        "required_docs": ["contract", "specification"],
    },
    {
        "id": "run",
        "label": "Исполнение",
        "hint": "Идут проект и производство.",
        "statuses": ["in_progress", "production"],
        "owner_roles": ["rp", "production", "kb", "omto", "finance"],
        "gates": ["before_project", "before_production"],
        "required_docs": ["contract", "plan"],
    },
    {
        "id": "ship",
        "label": "Отгрузка",
        "hint": "Приёмка, затем отгрузка.",
        "statuses": ["acceptance", "shipped"],
        "owner_roles": ["production", "omto", "ks", "rp"],
        "gates": ["before_psi", "before_ship"],
        "required_docs": ["acceptance"],
    },
    {
        "id": "pay",
        "label": "Оплата",
        "hint": "Ждём оплату и закрываем заказ.",
        "statuses": ["awaiting_payment", "closed"],
        "owner_roles": ["finance", "rp", "ks", "legal", "production"],
        "gates": ["before_close"],
        "required_docs": ["contract", "acceptance"],
    },
]


def _finding_kind(field: str) -> str:
    text = str(field or "").strip()
    if text.startswith("section:"):
        return "section"
    if text.startswith("check:"):
        return "check"
    if text.startswith("baseline:"):
        return "baseline"
    if text.startswith("risk:"):
        return "risk"
    if text.startswith("draft_1c_"):
        return "draft_1c"
    return "finding"


def _section_field_label(section: str, key: str) -> str:
    for items in ROLE_FIELDS_SPEC.values():
        for spec in items:
            if spec["section"] == section and spec["key"] == key:
                return f"{spec['section_title']} · {spec['label']}"
    return _FIELD_LABELS.get(key, f"{section}.{key}")


def _section_field_owner(section: str, key: str) -> str:
    for role_id, items in ROLE_FIELDS_SPEC.items():
        for spec in items:
            if spec["section"] == section and spec["key"] == key:
                return role_id
    if section == "contract" and key in LEGAL_KEYS:
        return "legal"
    writers = SECTION_WRITERS.get(section)
    if writers:
        return next(iter(writers))
    return "ks"


def _finding_label(order: ExternalOrder, item: ExternalOrderFinding) -> str:
    field = str(item.field or "").strip()
    if field.startswith("section:"):
        target = field[len("section:"):]
        if "." in target:
            sec, key = target.split(".", 1)
            return _section_field_label(sec, key)
        return _FIELD_LABELS.get(target, target)
    if field.startswith("check:"):
        cid = field[len("check:"):].strip()
        chk = next((c for c in order.checks if c.id == cid), None)
        if chk is not None:
            return f"Чек-лист: {chk.text}"
        return "Пункт чек-листа"
    if field.startswith("baseline:"):
        return "Базовая версия расчёта (черновик)"
    if field.startswith("risk:"):
        return "Риск проекта (черновик)"
    if field.startswith("draft_1c_"):
        doc_kind = field[len("draft_1c_"):]
        kind_label = _DRAFT_1C_LABELS.get(doc_kind, f"Документ 1С ДО ({doc_kind})")
        if item.source_ref:
            return f"{kind_label}: {item.source_ref}"
        return kind_label
    if field.startswith("повтор "):
        tail = field[len("повтор "):].strip()
        return f"Повторное заключение ({ROLES.get(tail, tail)})"
    return _FIELD_LABELS.get(field, field)


def _finding_prefill(order: ExternalOrder, item: ExternalOrderFinding) -> dict:
    field = str(item.field or "").strip()
    if not field.startswith("draft_1c_"):
        return {}
    doc_kind = field[len("draft_1c_"):]
    saved = _load(item.location) if str(item.location or "").strip().startswith("{") else {}
    base = {
        "kind": doc_kind,
        "title": item.source_ref or f"Документ по заказу {order.code}",
        "text": item.value or "",
        "order_id": order.id,
        "order_code": order.code,
        "customer": order.customer,
        "product": order.product,
    }
    if isinstance(saved, dict):
        base.update(saved)
    return base


def _current_stage_index(order: ExternalOrder) -> int:
    for idx, spec in enumerate(STAGE_PASSPORT_SPECS):
        if order.status in spec["statuses"]:
            return idx
    stage_alias = {
        "execution": "run",
        "plan": "run",
        "acceptance": "ship",
        "payment": "pay",
    }.get(order.stage, order.stage)
    for idx, spec in enumerate(STAGE_PASSPORT_SPECS):
        if spec["id"] == stage_alias:
            return idx
    return 0


def _stage_completed_by(order: ExternalOrder, spec: dict) -> str:
    statuses_labels = {STATUSES.get(st, st) for st in spec["statuses"]}
    for entry in reversed(list(order.audit)):
        if entry.action in {"transition", "decision", "create", "onec_path", "onec_link"}:
            if (
                entry.after_value in statuses_labels
                or entry.before_value in statuses_labels
                or entry.detail in statuses_labels
                or (spec["id"] == "committee" and entry.action == "decision")
            ):
                role_label = ROLES.get(entry.actor_role, entry.actor_role)
                return f"{entry.actor_fio or 'Система'} ({role_label}) · {entry.detail}"
    if order.created_by:
        return f"{order.created_by} · этап пройден"
    return "Этап пройден"


def build_stage_passports(order: ExternalOrder) -> list[dict]:
    current_idx = _current_stage_index(order)
    order_blocks = blocks_for(order)
    passports: list[dict] = []
    for idx, spec in enumerate(STAGE_PASSPORT_SPECS):
        gates = list(spec["gates"])
        gates_set = set(gates)
        applicable = [
            chk
            for chk in order.checks
            if chk.gate in gates_set and chk.status != "not_applicable"
        ]
        checks_total = len(applicable)
        checks_done = sum(1 for chk in applicable if chk.status == "done")
        open_checks = [
            {
                "id": chk.id,
                "gate": chk.gate,
                "text": chk.text,
                "owner_role": chk.owner_role,
                "owner_label": ROLES.get(chk.owner_role, chk.owner_role),
                "blocking": bool(chk.blocking),
            }
            for chk in applicable
            if chk.status != "done"
        ]
        required_docs: list[dict] = []
        for doc_kind in spec["required_docs"]:
            matching = [
                doc
                for doc in order.documents
                if doc.kind == doc_kind
                or (doc_kind == "acceptance" and doc.kind in {"acceptance", "shipping", "upd"})
            ]
            if matching:
                required_docs.append(
                    {
                        "kind": doc_kind,
                        "label": _DOC_KIND_LABELS.get(doc_kind, doc_kind),
                        "present": True,
                        "approved": any(bool(doc.approved) for doc in matching),
                        "version": str(matching[-1].version or "v1"),
                    }
                )
            elif doc_kind == "protocol" and any(dec.protocol.strip() for dec in order.decisions):
                proto = next(dec.protocol.strip() for dec in order.decisions if dec.protocol.strip())
                required_docs.append(
                    {
                        "kind": doc_kind,
                        "label": _DOC_KIND_LABELS.get(doc_kind, doc_kind),
                        "present": True,
                        "approved": True,
                        "version": proto,
                    }
                )
            else:
                required_docs.append(
                    {
                        "kind": doc_kind,
                        "label": _DOC_KIND_LABELS.get(doc_kind, doc_kind),
                        "present": False,
                        "approved": False,
                        "version": "",
                    }
                )
        if idx < current_idx or (idx == current_idx and order.status == "closed"):
            state = "done"
            blocker = ""
            completed_by = _stage_completed_by(order, spec)
        elif idx == current_idx:
            blocker = (
                order_blocks[0]
                if order_blocks
                else (f"Не закрыт пункт: {open_checks[0]['text']}" if open_checks else "")
            )
            has_hard_block = (
                order.status == "rework"
                or any(chk.status in {"overdue", "blocked"} for chk in applicable)
                or (
                    spec["id"] == "contract"
                    and any(_recorded_mismatch(d) for d in order.diffs)
                )
            )
            state = "blocked" if (blocker and has_hard_block) else "current"
            completed_by = ""
        else:
            state = "upcoming"
            blocker = ""
            completed_by = ""
        owner_roles = list(spec["owner_roles"])
        passports.append(
            {
                "id": spec["id"],
                "label": spec["label"],
                "hint": spec["hint"],
                "statuses": list(spec["statuses"]),
                "state": state,
                "owner_roles": owner_roles,
                "owner_labels": [ROLES.get(r, r) for r in owner_roles],
                "gates": gates,
                "checks_done": checks_done,
                "checks_total": checks_total,
                "open_checks": open_checks,
                "required_docs": required_docs,
                "blocker": blocker,
                "completed_by": completed_by,
            }
        )
    return passports


_KNOWN_TOKENS: dict[str, tuple[str, ...]] = {
    "price": ("сумма 1с", "цена:"),
    "vat": ("ндс:", "ндс "),
    "currency": ("валюта:", "валют"),
    "discount": ("скидк",),
    "plan_note": ("срок",),
    "schedule": ("оплата:", "оплачено"),
    "composition": ("состав:", "изделие:"),
    "warranty": ("гаранти",),
    "sanctions": ("санкц",),
    "payment": ("оплата:", "оплачено"),
    "term": ("срок",),
}


def known_facts(order: ExternalOrder) -> list[str]:
    """Факты, которые уже есть в карточке, пути 1С и опросном листе. По ним вопрос не задаётся."""
    from app.services.external_order_case import survey_sheet_lines

    facts: list[str] = []
    if str(order.customer or "").strip():
        inn = f", ИНН {order.inn}" if str(order.inn or "").strip() else ""
        facts.append(f"Заказчик: {order.customer}{inn}")
    if str(order.product or "").strip():
        facts.append(f"Изделие: {order.product}")
    link = _onec_link(order)
    if str(link.get("amount") or "").strip():
        facts.append(f"Сумма 1С: {link.get('amount')}")
    if str(link.get("vat") or "").strip():
        facts.append(f"НДС: {link.get('vat')}")
    if str(link.get("currency") or "").strip():
        facts.append(f"Валюта: {link.get('currency')}")
    if str(link.get("delivery_days") or "").strip():
        facts.append(f"Срок поставки: {link.get('delivery_days')}")
    if str(link.get("payment_form") or "").strip():
        facts.append(f"Форма оплаты: {link.get('payment_form')}")
    if str(link.get("delivery") or "").strip():
        facts.append(f"Доставка: {link.get('delivery')}")
    composition = str(link.get("product") or link.get("order_subject") or "").strip()
    if composition:
        facts.append(f"Состав: {composition}")
    if str(link.get("end_customer") or "").strip():
        facts.append(f"Конечный заказчик: {link.get('end_customer')}")
    if str(link.get("valid_until") or "").strip():
        facts.append(f"Срок действия ТКП: {link.get('valid_until')}")
    number = str(link.get("order_number") or "").strip()
    if number:
        dated = f" от {link.get('order_date')}" if str(link.get("order_date") or "").strip() else ""
        facts.append(f"Заказ клиента: {number}{dated}")
    tkp = str(link.get("tkp_number") or "").strip()
    if tkp:
        facts.append(f"ТКП: {tkp}")
    contract = " ".join(
        part for part in (str(link.get("contract_number") or "").strip(), str(link.get("contract") or "").strip()) if part
    )
    if contract:
        facts.append(f"Договор: {contract}")
    if str(link.get("paid") or "").strip() or order.payment_percent:
        facts.append(
            f"Оплата: {link.get('paid') or '0'} из {link.get('amount') or '0'}, {order.payment_percent}%"
        )
    if str(link.get("deal_start") or "").strip() or str(link.get("deal_finish") or "").strip():
        facts.append(f"Срок сделки: {link.get('deal_start') or '—'} — {link.get('deal_finish') or '—'}")
    comment = str(link.get("comment") or "").strip()
    if comment:
        facts.append(f"Комментарий 1С: {comment}")
    path = _path_label(order)
    if path:
        facts.append(f"Путь 1С: {path}")
    if list(order.lines):
        shown = "; ".join(
            f"{line.name} ({line.qty})" if line.qty else line.name for line in list(order.lines)[:8]
        )
        facts.append(f"Состав: {shown}")
    for line in survey_sheet_lines(order):
        facts.append(f"Опросный лист: {line}")
    return facts[:40]


def _covered_by_known(key: str, facts: list[str]) -> bool:
    tokens = _KNOWN_TOKENS.get(key)
    if not tokens:
        return False
    blob = " ".join(facts).casefold().replace("ё", "е")
    return any(token in blob for token in tokens)


def build_role_questions(order: ExternalOrder) -> dict[str, list[dict]]:
    sections = _load(order.sections_json)
    facts = known_facts(order)
    result: dict[str, list[dict]] = {role_id: [] for role_id in ROLES}
    for role_id, specs in ROLE_FIELDS_SPEC.items():
        for spec in specs:
            sec = spec["section"]
            key = spec["key"]
            cur = str((sections.get(sec) or {}).get(key) or "").strip()
            if cur or _covered_by_known(key, facts):
                continue
            result.setdefault(role_id, []).append(
                {
                    "id": f"section:{sec}.{key}",
                    "field": f"section:{sec}.{key}",
                    "section": sec,
                    "key": key,
                    "check_id": "",
                    "gap_id": "",
                    "prompt": spec["prompt"],
                    "placeholder": spec["placeholder"],
                    "current_value": "",
                    "owner_role": role_id,
                    "owner_label": ROLES.get(role_id, role_id),
                }
            )
    sorted_checks = sorted(
        order.checks,
        key=lambda chk: _GATE_ORDER.index(chk.gate) if chk.gate in _GATE_ORDER else len(_GATE_ORDER),
    )
    for chk in sorted_checks:
        if chk.status in {"done", "not_applicable"}:
            continue
        owner = chk.owner_role or "ks"
        gate_label = _GATE_LABEL.get(chk.gate, chk.gate)
        result.setdefault(owner, []).append(
            {
                "id": f"check:{chk.id}",
                "field": f"check:{chk.id}",
                "section": "",
                "key": "",
                "check_id": chk.id,
                "gap_id": "",
                "prompt": f"Подтвердите пункт чек-листа ({gate_label}): «{chk.text}»",
                "placeholder": "Укажите доказательство (документ, расчёт, письмо, дата)",
                "current_value": str(chk.evidence or ""),
                "owner_role": owner,
                "owner_label": ROLES.get(owner, owner),
            }
        )
    for gap in order.gaps:
        if gap.status != "open" or _covered_by_known(str(gap.field or ""), facts):
            continue
        owner = gap.owner_role or "ks"
        label = _FIELD_LABELS.get(gap.field, gap.field)
        result.setdefault(owner, []).append(
            {
                "id": f"gap:{gap.id}",
                "field": f"gap:{gap.id}",
                "section": "",
                "key": "",
                "check_id": "",
                "gap_id": gap.id,
                "prompt": f"Закройте пробел по полю «{label}»: {gap.detail}",
                "placeholder": "Укажите значение и место в источнике",
                "current_value": "",
                "owner_role": owner,
                "owner_label": ROLES.get(owner, owner),
            }
        )
    return result


# Службы текущего этапа — те же, что у линейки на экране (externalOrderReview LINE).
_QUEUE_STAGE_ROLES: dict[str, set[str]] = {
    "draft": {"ks", "development"},
    "collecting": {"ks", "development"},
    "calculating": {"kb", "omto", "finance", "production", "legal", "development"},
    "rework": {"kb", "omto", "finance", "production", "legal", "development"},
    "ready_committee": {"committee", "finance", "ks"},
    "confirmed": {"committee", "finance", "ks"},
    "confirmed_conditions": {"committee", "finance", "ks"},
    "tkp_issued": {"ks"},
    "contract_review": {"ks", "legal", "finance", "rp"},
    "contract_signed": {"ks", "legal", "finance", "rp"},
    "in_progress": {"rp", "kb", "omto", "production"},
    "production": {"rp", "kb", "omto", "production"},
    "acceptance": {"production", "ks", "omto", "rp"},
    "shipped": {"production", "ks", "omto", "rp"},
    "awaiting_payment": {"finance", "ks", "rp"},
}


def _waiting_roles(order: ExternalOrder) -> list[str]:
    """Очередь службы — заказы её текущего этапа, без пунктов будущих ворот."""
    if order.status == "closed":
        return []
    owners = _QUEUE_STAGE_ROLES.get(order.status, set())
    return [role_id for role_id in ROLES if role_id != "viewer" and role_id in owners]


def _attention(order: ExternalOrder) -> list[dict]:
    """Коротко, почему заказ стоит в очереди службы. Карточку для этого открывать не нужно."""
    overdue: list[dict] = []
    checks: list[dict] = []
    gaps: list[dict] = []
    notes: list[dict] = []
    blocks: list[dict] = []
    for item in order.checks:
        if item.status in {"done", "not_applicable"} or not item.owner_role:
            continue
        row = {"role": item.owner_role, "kind": "check", "text": item.text[:180]}
        if item.status == "overdue":
            row["kind"] = "overdue"
            overdue.append(row)
        else:
            checks.append(row)
    for item in order.gaps:
        if item.status != "open" or not item.owner_role:
            continue
        gaps.append({"role": item.owner_role, "kind": "gap", "text": (item.detail or item.field)[:180]})
    for item in order.notices:
        if item.kind not in {"overdue", "change"} or not item.role:
            continue
        notes.append({"role": item.role, "kind": item.kind, "text": item.title[:180]})
    target = NEXT_GATE.get(order.status, "")
    for role_id in TRANSITION_ROLES.get(target, set()):
        for text in blocks_for(order):
            blocks.append({"role": role_id, "kind": "block", "text": text[:180]})
    return (notes + overdue + blocks + gaps + checks)[:12]


def _brief(order: ExternalOrder) -> dict:
    open_checks_count = sum(1 for item in order.checks if item.status not in {"done", "not_applicable"})
    open_diffs_count = sum(1 for item in order.diffs if item.status != "closed")
    draft_findings_count = sum(1 for item in order.findings if item.status == "draft")
    return {
        "id": order.id,
        "code": order.code,
        "customer": order.customer,
        "product": order.product,
        "stage": order.stage,
        "stage_label": STAGES.get(order.stage, order.stage),
        "status": order.status,
        "status_label": STATUSES.get(order.status, order.status),
        "route": order.route,
        "route_label": ROUTES.get(order.route, ""),
        "payment_percent": order.payment_percent,
        "payment_note": _payment_note(order),
        "onec_number": _onec_number(order),
        "onec_key": _onec_key(order),
        "onec_tkp_key": str(_onec_link(order).get("tkp_key") or "").strip(),
        "path_label": _path_label(order),
        "blocks": blocks_for(order),
        "open_checks_count": open_checks_count,
        "open_diffs_count": open_diffs_count,
        "draft_findings_count": draft_findings_count,
        "waiting_roles": _waiting_roles(order),
        "attention": _attention(order),
    }


def _ai_fields(order: ExternalOrder) -> dict[str, dict]:
    """Поля, заполненные ИИ: черновик ждёт владельца или принятое значение ещё не переписано вручную."""
    sections = _load(order.sections_json)
    marks: dict[str, dict] = {}
    for item in order.findings:
        field = str(item.field or "")
        if not field.startswith("section:") or not is_ai_finding(item.proposed_by, item.confidence):
            continue
        target = field[len("section:"):]
        if "." not in target or item.status not in {"draft", "accepted"}:
            continue
        sec, key = target.split(".", 1)
        current = str((sections.get(sec) or {}).get(key) or "").strip()
        if item.status == "accepted" and current != str(item.value or "").strip():
            continue
        if item.status == "draft" and marks.get(target, {}).get("status") == "accepted":
            continue
        doc = next((document for document in order.documents if document.id == item.document_id), None)
        marks[target] = {
            "status": item.status,
            "finding_id": item.id,
            "value": item.value,
            "source": item.source_ref,
            "quote": item.location,
            "confidence": item.confidence,
            "trace": _finding_trace(order, item, doc),
        }
    return marks


def _finding_trace(order: ExternalOrder, item: ExternalOrderFinding, doc: ExternalOrderDocument | None = None) -> dict[str, str]:
    """Документ, версия, пункт, фрагмент, правило и автор подтверждения."""
    found = doc or next((document for document in order.documents if document.id == item.document_id), None)
    author = str(item.proposed_by or "").strip()
    return {
        "document": found.title if found is not None else str(item.source_ref or ""),
        "version": found.version if found is not None else "",
        "clause": str(item.location or ""),
        "fragment": str(item.value or "")[:400],
        "rule": str(item.field or ""),
        "author": author,
    }


def _project_note(order: ExternalOrder) -> str:
    sections = _load(order.sections_json)
    queue = sections.get("turbo_queue") if isinstance(sections.get("turbo_queue"), dict) else {}
    if str(queue.get("status") or "") == "queued":
        return (
            f"План в очереди TurboProject, попытка {queue.get('attempts') or 1}. "
            f"Задачи сохранены в деле. {queue.get('error') or ''}"
        ).strip()
    return "Публикация плана в TurboProject не подключена"


def _detail(order: ExternalOrder) -> dict:
    from app.services.external_order_case import documents_view

    documents, document_links = documents_view(order)
    body = _brief(order)
    body.update(
        {
            "inn": order.inn,
            "contact": order.contact,
            "order_type": order.order_type,
            "priority": order.priority,
            "owners": _load(order.owners_json),
            "sections": _load(order.sections_json),
            "ai_fields": _ai_fields(order),
            "project_note": _project_note(order),
            "known": known_facts(order),
            "stage_passports": build_stage_passports(order),
            "role_questions": build_role_questions(order),
            "checks": [
                {
                    "id": item.id,
                    "gate": item.gate,
                    "text": item.text,
                    "owner_role": item.owner_role,
                    "owner_label": ROLES.get(item.owner_role, item.owner_role),
                    "status": item.status,
                    "status_label": CHECK_STATUSES.get(item.status, item.status),
                    "blocking": item.blocking,
                    "due_at": item.due_at.isoformat() if item.due_at else "",
                    "evidence": item.evidence,
                    "confirmed_by": item.confirmed_by,
                }
                for item in order.checks
            ],
            "diffs": [
                {
                    "id": item.id,
                    "code": item.code,
                    "area": item.area,
                    "title": item.title,
                    "owner_role": item.owner_role,
                    "owner_label": ROLES.get(item.owner_role, item.owner_role),
                    "level": item.level,
                    "status": item.status,
                    "left_value": item.left_value,
                    "right_value": item.right_value,
                    "note": item.note,
                }
                for item in order.diffs
            ],
            "risks": [
                {
                    "id": item.id,
                    "title": item.title,
                    "impact": item.impact,
                    "measure": item.measure,
                    "source": item.source,
                    "status": item.status,
                }
                for item in order.risks
            ],
            "decisions": [
                {
                    "id": item.id,
                    "protocol": item.protocol,
                    "decision": item.decision,
                    "allowed_stage": item.allowed_stage,
                    "conditions": item.conditions,
                    "conditions_closed": item.conditions_closed,
                    "base_version": item.base_version,
                    "decided_by": item.decided_by,
                }
                for item in order.decisions
            ],
            "findings": [
                {
                    "id": item.id,
                    "field": item.field,
                    "value": item.value,
                    "source_ref": item.source_ref,
                    "location": item.location,
                    "document_id": item.document_id,
                    "confidence": item.confidence,
                    "status": item.status,
                    "owner_role": item.owner_role,
                    "owner_label": ROLES.get(item.owner_role, item.owner_role),
                    "proposed_by": item.proposed_by,
                    "trace": _finding_trace(order, item),
                    "filled_by": "ai" if is_ai_finding(item.proposed_by, item.confidence) else "",
                    "kind": _finding_kind(item.field),
                    "label": _finding_label(order, item),
                    **(
                        {"prefill": _finding_prefill(order, item)}
                        if str(item.field or "").startswith("draft_1c_")
                        else {}
                    ),
                }
                for item in order.findings
            ],
            "documents": documents,
            "document_links": document_links,
            "audit": [
                {
                    "id": item.id,
                    "actor_fio": item.actor_fio,
                    "actor_role": item.actor_role,
                    "action": item.action,
                    "detail": item.detail,
                    "before_value": item.before_value,
                    "after_value": item.after_value,
                }
                for item in order.audit
            ],
            "gaps": [
                {
                    "id": item.id,
                    "field": item.field,
                    "owner_role": item.owner_role,
                    "owner_label": ROLES.get(item.owner_role, item.owner_role),
                    "due_at": item.due_at.isoformat() if item.due_at else "",
                    "status": item.status,
                    "detail": item.detail,
                }
                for item in order.gaps
            ],
            "baselines": [
                {
                    "id": item.id,
                    "code": item.code,
                    "composition": item.composition,
                    "cost": item.cost,
                    "mcr": item.mcr,
                    "margin": item.margin,
                    "bdds": item.bdds,
                    "deadlines": item.deadlines,
                    "reason": item.reason,
                    "immutable": item.immutable,
                }
                for item in order.baselines
            ],
            "tasks": [
                {
                    "id": item.id,
                    "title": item.title,
                    "kind": item.kind,
                    "owner_role": item.owner_role,
                    "depends_on": item.depends_on,
                    "critical": item.critical,
                    "approved": item.approved,
                    "published": item.published,
                    "source_ref": item.source_ref or "",
                }
                for item in order.tasks
            ],
            "lines": [
                {
                    "id": item.id,
                    "name": item.name,
                    "qty": item.qty,
                    "amount": item.amount,
                    "change": item.change,
                }
                for item in order.lines
            ],
            "notices": [
                {
                    "id": item.id,
                    "kind": item.kind,
                    "role": item.role,
                    "title": item.title,
                    "body": item.body,
                    "mail_status": item.mail_status,
                }
                for item in order.notices
            ],
        }
    )
    return body


def list_orders(db: Session) -> list[dict]:
    rows = db.query(ExternalOrder).order_by(ExternalOrder.created_at.desc()).all()
    return [_brief(row) for row in rows]


_briefs_cache: tuple[float, list[dict]] | None = None
_briefs_lock = threading.Lock()
_BRIEFS_FRESH = 15.0
_BRIEFS_STALE = 180.0


def order_briefs() -> list[dict]:
    """Список заказов без ожидания чужого соединения.

    Свежий ответ отдаётся сразу. Если пул занят, отдаётся список не старше
    трёх минут. Иначе один запрос, даже когда экран открыл список несколько раз.
    """
    global _briefs_cache
    import time

    now = time.monotonic()
    cached = _briefs_cache
    if cached is not None and now - cached[0] < _BRIEFS_FRESH:
        return cached[1]
    from app.db.session import SessionLocal, pool_is_saturated

    if cached is not None and pool_is_saturated() and now - cached[0] < _BRIEFS_STALE:
        return cached[1]
    if not _briefs_lock.acquire(timeout=1.5):
        cached = _briefs_cache
        if cached is not None:
            return cached[1]
        raise ExternalOrderError(
            "Список заказов занят другими запросами. Откройте вкладку ещё раз.",
            503,
        )
    try:
        cached = _briefs_cache
        now = time.monotonic()
        if cached is not None and now - cached[0] < _BRIEFS_FRESH:
            return cached[1]
        if cached is not None and pool_is_saturated() and now - cached[0] < _BRIEFS_STALE:
            return cached[1]
        db = SessionLocal()
        try:
            items = list_orders(db)
        finally:
            db.close()
        _briefs_cache = (time.monotonic(), items)
        return items
    finally:
        _briefs_lock.release()


_CASE_STALE = 180.0
_case_cache: dict[str, tuple[float, dict]] = {}


def cached_brief(order_id: str) -> dict | None:
    cached = _briefs_cache
    if cached is None or not order_id:
        return None
    for item in cached[1]:
        if item.get("id") == order_id or item.get("code") == order_id:
            return item
    return None


def remember_case(order_id: str, payload: dict) -> dict:
    if order_id:
        _case_cache[order_id] = (time.monotonic(), payload)
        if len(_case_cache) > 40:
            oldest = min(_case_cache, key=lambda key: _case_cache[key][0])
            _case_cache.pop(oldest, None)
    return payload


def detail_while_busy(cached: tuple[float, dict] | None) -> dict | None:
    """Последняя карточка, если пул занят. None — можно открывать сессию."""
    from app.db.session import pool_is_saturated

    if not pool_is_saturated():
        return None
    if cached is not None and time.monotonic() - cached[0] < _CASE_STALE:
        return cached[1]
    raise ExternalOrderError(
        "Карточка занята другими запросами. В списке видна последняя сводка. Откройте заказ ещё раз.",
        503,
    )


def case_while_busy(order_id: str) -> dict:
    """Сводка для агента без соединения: последнее чтение или строка списка."""
    cached = _case_cache.get(order_id)
    if cached is not None and time.monotonic() - cached[0] < _CASE_STALE:
        body = dict(cached[1])
        body["note"] = "Сводка по последнему чтению: соединения сейчас заняты."
        return body
    brief = cached_brief(order_id)
    if brief is None:
        return {
            "ok": False,
            "summary": (
                "Соединения заняты. Сводка на экране — по уже открытой карточке. "
                "Повторите разбор через несколько секунд."
            ),
            "facts": "",
            "known": [],
            "questions": [],
        }
    path = str(brief.get("path_label") or "").strip()
    payment = str(brief.get("payment_note") or "").strip()
    summary = (
        f"Заказ {brief.get('code')} ({brief.get('customer')} — {brief.get('product')}), "
        f"этап «{brief.get('stage_label')}». "
        "Свежие данные из базы не прочитаны: соединения заняты. "
        f"Путь 1С: {path or 'не записан'}."
    )
    if payment:
        summary = f"{summary} {payment}"
    return {
        "ok": True,
        "id": brief.get("id"),
        "code": brief.get("code"),
        "customer": brief.get("customer"),
        "product": brief.get("product"),
        "stage_label": brief.get("stage_label"),
        "status_label": brief.get("status_label"),
        "payment_note": payment,
        "path_label": path,
        "summary": summary,
        "facts": path,
        "known": [path] if path else [],
        "questions": [],
        "blocks": brief.get("blocks") or [],
        "note": "Сводка по списку заказов, без повторного чтения базы и 1С.",
    }


def _onec_progress_note(order: ExternalOrder) -> str:
    link = _onec_link(order)
    parts = []
    tkp = str(link.get("tkp_number") or "").strip()
    if tkp:
        label = str(link.get("tkp_status_label") or "").strip()
        parts.append(f"ТКП {tkp}" + (f" ({label})" if label else ""))
    order_number = str(link.get("order_number") or "").strip()
    if order_number:
        parts.append(f"заказ клиента {order_number}")
    contract = str(link.get("contract_number") or "").strip()
    if contract:
        parts.append(f"договор {contract}")
    return ", ".join(parts)


def _passed_gates(order: ExternalOrder) -> set[str]:
    current = _current_stage_index(order)
    gates: set[str] = set()
    for index, spec in enumerate(STAGE_PASSPORT_SPECS):
        if index < current:
            gates.update(spec["gates"])
    return gates


def _sync_passed_checks(row: ExternalOrder) -> int:
    """Этап уже позади по пути 1С — его пункты не остаются 0/N. Будущие этапы не закрываются."""
    note = _onec_progress_note(row)
    if not note:
        return 0
    evidence = f"Путь 1С уже пройден: {note}"
    gates = _passed_gates(row)
    changed = 0
    for item in row.checks:
        if item.gate not in gates or item.status in {"done", "not_applicable"}:
            continue
        item.status = "done"
        item.evidence = evidence
        if not str(item.confirmed_by or "").strip():
            item.confirmed_by = "1С"
        changed += 1
    return changed


def get_order(db: Session, order_id: str) -> dict:
    from app.services.external_order_case import refresh_overdue

    row = _order(db, order_id)
    refresh_overdue(db, row)
    _sync_passed_checks(row)
    db.commit()
    db.refresh(row)
    return _detail(row)


def _line_value(line: str, *tokens: str) -> str:
    folded = line.casefold().replace("ё", "е")
    if not any(token in folded for token in tokens) or ":" not in line:
        return ""
    return line.split(":", 1)[1].strip()


def register_request(db: Session, *, role: str, fio: str, files: list[dict]) -> dict:
    """АТ-01: файлы запроса, ТЗ и переписки создают карточку, реквизиты и пробелы с источником."""
    from app.services.external_order_case import _docx_paragraphs, _pdf_lines, add_gap, store_file

    if role not in {"ks", "development"}:
        raise ExternalOrderError("Запрос регистрирует коммерческая служба или служба развития", 403)
    batch = [item for item in files if isinstance(item, dict) and str(item.get("content_base64") or "").strip()]
    if not batch:
        raise ExternalOrderError("Нужны файлы запроса, ТЗ или переписки", 400)
    customer = ""
    product = ""
    inn = ""
    for item in batch:
        name = str(item.get("filename") or "")
        raw = base64.b64decode(str(item.get("content_base64") or "") or "", validate=False)
        suffix = Path(name).suffix.casefold()
        lines = _docx_paragraphs(raw) if suffix == ".docx" else (_pdf_lines(raw) or [])
        for line in lines:
            customer = customer or _line_value(line, "заказчик", "контрагент")
            product = product or _line_value(line, "изделие", "продукт", "предмет")
            inn = inn or _line_value(line, "инн")
    missing_customer = not customer
    missing_product = not product
    created = create_order(
        db,
        role=role,
        fio=fio,
        fields={
            "customer": customer or "Заказчик не извлечён",
            "product": product or "Продукт не извлечён",
            "inn": inn,
        },
    )
    row = _order(db, created["id"])
    first_name = ""
    for item in batch:
        filename = str(item.get("filename") or "запрос.docx")
        first_name = first_name or filename
        kind = str(item.get("kind") or "").strip()
        folded = filename.casefold()
        if kind not in {"tz", "tkp", "contract", "specification", "correspondence", "other"}:
            if "тз" in folded or folded.startswith("tz"):
                kind = "tz"
            elif "договор" in folded:
                kind = "contract"
            else:
                kind = "correspondence"
        store_file(
            db,
            row,
            role=role,
            fio=fio,
            kind=kind,
            filename=filename,
            content_b64=str(item.get("content_base64") or ""),
        )
    if missing_customer:
        add_gap(db, row, field="customer", owner_role="ks", detail=f"Источник: {first_name}. Заказчик в тексте не найден")
    if missing_product:
        add_gap(db, row, field="product", owner_role="ks", detail=f"Источник: {first_name}. Продукт в тексте не найден")
    db.commit()
    db.refresh(row)
    return _detail(row)


def _request_lines(fields: dict) -> list[dict[str, str]]:
    raw = fields.get("lines") if isinstance(fields.get("lines"), list) else []
    lines: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        lines.append(
            {
                "name": name[:512],
                "qty": str(item.get("qty") or "").strip()[:64],
                "amount": str(item.get("amount") or "").strip()[:64],
            }
        )
    return lines


def _request_sections(fields: dict, product: str) -> dict:
    terms = fields.get("terms") if isinstance(fields.get("terms"), dict) else {}
    commercial = {
        key: str(terms.get(key) or "").strip()
        for key in ("price", "vat", "currency", "discount")
        if str(terms.get(key) or "").strip()
    }
    onec = {
        key: str(terms.get(key) or "").strip()
        for key in _TKP_TERM_FIELDS
        if str(terms.get(key) or "").strip()
    }
    if product and not onec.get("product"):
        onec["product"] = product
    for key in ("vat", "currency"):
        if commercial.get(key) and not onec.get(key):
            onec[key] = commercial[key]
    sections = {key: {} for key in SECTION_WRITERS}
    if commercial:
        sections["commercial"] = commercial
    if onec:
        sections["onec"] = onec
    return sections


def create_order(db: Session, *, role: str, fio: str, fields: dict, allow_import: bool = False) -> dict:
    allowed = {"ks", "development"} | (_LINK_ROLES if allow_import else set())
    if role not in allowed:
        raise ExternalOrderError("Карточку создаёт коммерческая служба или служба развития", 403)
    customer = str(fields.get("customer") or "").strip()
    lines = _request_lines(fields)
    product = str(fields.get("product") or "").strip()
    if not product and lines:
        shown = [item["name"] for item in lines[:3]]
        rest = len(lines) - len(shown)
        if rest > 0:
            shown.append(f"ещё {rest}")
        product = "; ".join(shown)
    if not customer or not product:
        raise ExternalOrderError("Нужны заказчик и хотя бы одна номенклатура", 400)
    row = ExternalOrder(
        id=_new_id(),
        code=_next_order_code(db),
        customer=customer,
        inn=str(fields.get("inn") or "").strip(),
        contact=str(fields.get("contact") or "").strip(),
        product=product,
        order_type=str(fields.get("order_type") or "").strip(),
        priority=str(fields.get("priority") or "").strip(),
        stage="request",
        status="draft",
        owners_json=_dump({"ks": fio if role == "ks" else "", "rp": ""}),
        sections_json=_dump(_request_sections(fields, product)),
        payment_percent=0,
        created_by=fio,
    )
    db.add(row)
    db.flush()
    for item in lines:
        db.add(
            ExternalOrderLine(
                id=_new_id(),
                order_id=row.id,
                name=item["name"],
                qty=item["qty"],
                amount=item["amount"],
            )
        )
    from app.services.external_order_case import check_seed

    for gate, text, owner in _CHECKS:
        seed = check_seed(gate, row.route, row.order_type, text)
        db.add(
            ExternalOrderCheck(
                id=_new_id(),
                order_id=row.id,
                gate=gate,
                text=text,
                owner_role=owner,
                status=seed["status"],
                evidence=seed["evidence"],
                blocking=seed["blocking"],
                due_at=seed["due_at"],
            )
        )
    for code, area, title, owner, level in _DIFFS:
        db.add(
            ExternalOrderDiff(
                id=_new_id(),
                order_id=row.id,
                code=code,
                area=area,
                title=title,
                owner_role=owner,
                level=level,
            )
        )
    _audit(db, row, fio=fio, role=role, action="create", detail=row.code)
    db.commit()
    db.refresh(row)
    return _detail(row)


def _guard_section(role: str, section: str, values: dict) -> None:
    _require_business(role)
    if role == "rp" and section == "commercial" and PRICE_KEYS & set(values):
        raise ExternalOrderError("РП не меняет цену", 403)
    if role == "rp" and section == "finance":
        raise ExternalOrderError("РП не меняет платёжный факт", 403)
    if role == "legal" and (
        section == "calculation" or (section == "commercial" and PRICE_KEYS & set(values))
    ):
        raise ExternalOrderError("Юридическая служба не утверждает цену и бюджет", 403)
    writers = SECTION_WRITERS.get(section)
    if writers is None:
        raise ExternalOrderError("Неизвестный раздел", 400)
    if role not in writers:
        raise ExternalOrderError("Этот раздел ведёт другая роль", 403)
    if section == "contract" and LEGAL_KEYS & set(values) and role != "legal":
        raise ExternalOrderError("Нельзя изменить юридическое заключение", 403)


_CARD_DIFFS = {
    ("commercial", "price"): "B05",
    ("commercial", "vat"): "B06",
    ("contract", "price"): "B05",
    ("contract", "vat"): "B06",
}


def _sync_card_diff(row: ExternalOrder, section: str, key: str, value: str) -> None:
    """Правка цены или НДС в карточке становится блокирующим расхождением со ссылкой на поле."""
    code = _CARD_DIFFS.get((section, key))
    typed = str(value or "").strip()
    if not code or not typed:
        return
    match = next((item for item in row.diffs if item.code == code), None)
    if match is None or match.status == "closed":
        return
    link = _onec_link(row)
    baseline = str(link.get("amount") if key == "price" else link.get("vat") or "").strip()
    if baseline and not str(match.left_value or "").strip():
        match.left_value = baseline
    elif not str(match.left_value or "").strip():
        match.left_value = "значение до правки карточки"
    match.right_value = typed[:2000]
    match.note = f"поле {section}.{key}. Строка карточки сверена с источником"


def patch_order(db: Session, order_id: str, *, role: str, fio: str, fields: dict) -> dict:
    row = _order(db, order_id)
    _require_business(role)
    sections = fields.get("sections") if isinstance(fields.get("sections"), dict) else {}
    current = _load(row.sections_json)
    for name, values in sections.items():
        if not isinstance(values, dict):
            continue
        try:
            _guard_section(role, str(name), values)
        except ExternalOrderError as exc:
            if exc.status == 403:
                _audit(db, row, fio=fio, role=role, action="denied", detail=exc.detail)
                db.commit()
            raise
        bucket = dict(current.get(name) or {})
        bucket.update({str(key): value for key, value in values.items()})
        current[name] = bucket
        for key, value in values.items():
            _sync_card_diff(row, str(name), str(key), str(value or ""))
        for key, value in values.items():
            field = f"section:{name}.{key}"
            typed = str(value or "").strip()
            for item in row.findings:
                if item.field != field or item.status != "draft" or not is_ai_finding(item.proposed_by, item.confidence):
                    continue
                if not typed:
                    continue
                # Владелец сохранил поле сам: черновик ИИ закрыт его решением.
                item.status = "accepted" if typed == str(item.value or "").strip() else "rejected"
    if sections:
        row.sections_json = _dump(current)
        from app.services.external_order_case import _term_milestone

        _term_milestone(db, row)
    if "route" in fields:
        if role not in {"development", "committee"}:
            raise ExternalOrderError("Маршрут назначает служба развития или Комитет", 403)
        route = str(fields.get("route") or "")
        if route not in ROUTES:
            raise ExternalOrderError("Неизвестный маршрут", 400)
        row.route = route
        from app.services.external_order_case import retarget_checks

        retarget_checks(row)
        _audit(db, row, fio=fio, role=role, action="route", detail=route, before="", after=route)
    if isinstance(fields.get("owners"), dict) and role in {"ks", "development", "rp"}:
        owners = _load(row.owners_json)
        owners.update({str(key): str(value) for key, value in fields["owners"].items()})
        row.owners_json = _dump(owners)
    _audit(db, row, fio=fio, role=role, action="patch", detail="Карточка обновлена")
    db.commit()
    db.refresh(row)
    return _detail(row)


def _blocked(db: Session, row: ExternalOrder, fio: str, role: str, reason: str) -> None:
    from app.services.external_order_case import notify

    _audit(db, row, fio=fio, role=role, action="blocked", detail=reason)
    notify(db, row, kind="block", role=role, title="Переход заблокирован", body=reason)
    db.commit()


def _ready_block(row: ExternalOrder) -> str | None:
    from app.services.external_order_case import open_gate

    text = open_gate(row, {"before_calc", "before_committee"})
    if text:
        return f"Готово к Комитету заблокировано: {text}"
    if any(item.status == "open" for item in row.gaps):
        return "Готово к Комитету заблокировано: есть пробел без источника"
    return None


def _project_block(row: ExternalOrder) -> str | None:
    from app.services.external_order_case import open_gate

    if not str(_load(row.owners_json).get("rp") or "").strip():
        return "Проектный запуск заблокирован: не назначен руководитель проекта"
    if not any(task.approved for task in row.tasks):
        return "Проектный запуск заблокирован: базовый план не утверждён"
    if any(item.decision == "confirmed_conditions" and not item.conditions_closed for item in row.decisions):
        return "Проектный запуск заблокирован: не закрыты условия протокола"
    text = open_gate(row, {"before_project"})
    if text:
        return f"Проектный запуск заблокирован: {text}"
    return None


def _production_block(row: ExternalOrder) -> str | None:
    from app.services.external_order_case import open_gate

    price = str((_load(row.sections_json).get("commercial") or {}).get("price") or "").strip()
    if not price:
        return "Производственный запуск заблокирован: не подтверждена цена"
    text = open_gate(row, {"before_production"})
    if text:
        return f"Производственный запуск заблокирован: {text}"
    return None


def _ship_block(row: ExternalOrder) -> str | None:
    from app.services.external_order_case import open_gate

    text = open_gate(row, {"before_ship"})
    if text:
        return f"Отгрузка заблокирована: {text}"
    if not any(item.kind in {"acceptance", "shipping", "upd"} for item in row.documents):
        return "Отгрузка заблокирована: нет приёмочных документов"
    return None


def _block_for(row: ExternalOrder, target: str) -> str | None:
    if target == "ready_committee":
        return _ready_block(row)
    if target == "tkp_issued":
        return _tkp_block(list(row.decisions))
    if target == "contract_signed":
        return _sign_block(row)
    if target == "in_progress":
        return _project_block(row)
    if target == "production":
        return _production_block(row)
    if target == "shipped":
        return _ship_block(row)
    if target == "closed":
        return _close_block(row)
    return None


def transition(db: Session, order_id: str, *, role: str, fio: str, target: str) -> dict:
    row = _order(db, order_id)
    _require_business(role)
    if target not in TRANSITION_ROLES:
        raise ExternalOrderError("Неизвестный статус", 400)
    if role not in TRANSITION_ROLES[target]:
        raise ExternalOrderError("Этот переход выполняет другая роль", 403)
    reason = _block_for(row, target)
    if reason:
        _blocked(db, row, fio, role, reason)
        raise ExternalOrderError(reason, 409)
    if row.status == target:
        raise ExternalOrderError(f"Заказ уже в статусе «{STATUSES[target]}»", 409)
    allowed = TRANSITION_FROM.get(target, set())
    if row.status not in allowed:
        before = ", ".join(f"«{STATUSES[item]}»" for item in STATUSES if item in allowed)
        raise ExternalOrderError(
            f"Из статуса «{STATUSES.get(row.status, row.status)}» в «{STATUSES[target]}» перейти нельзя. "
            f"Сначала: {before}",
            409,
        )
    before_status = STATUSES.get(row.status, row.status)
    row.status = target
    row.stage = STATUS_STAGE[target]
    _audit(
        db,
        row,
        fio=fio,
        role=role,
        action="transition",
        detail=STATUSES[target],
        before=before_status,
        after=STATUSES[target],
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def confirm_check(db: Session, order_id: str, check_id: str, *, role: str, fio: str, evidence: str) -> dict:
    row = _order(db, order_id)
    item = next((check for check in row.checks if check.id == check_id), None)
    if item is None:
        raise ExternalOrderError("Пункт не найден", 404)
    _require_owner(role, item.owner_role, "пункт чек-листа")
    proof = (evidence or "").strip()
    if not proof:
        raise ExternalOrderError("Нужно доказательство", 400)
    item.status = "done"
    item.evidence = proof
    item.confirmed_by = fio
    _audit(db, row, fio=fio, role=role, action="confirm_check", detail=item.text)
    db.commit()
    db.refresh(row)
    return _detail(row)


def close_diff(db: Session, order_id: str, diff_id: str, *, role: str, fio: str, note: str) -> dict:
    row = _order(db, order_id)
    item = next((diff for diff in row.diffs if diff.id == diff_id), None)
    if item is None:
        raise ExternalOrderError("Пункт сверки не найден", 404)
    _require_owner(role, item.owner_role, "расхождение")
    if not (note or "").strip():
        raise ExternalOrderError("Нужно решение владельца", 400)
    item.status = "closed"
    item.note = note.strip()
    _audit(db, row, fio=fio, role=role, action="close_diff", detail=item.code)
    db.commit()
    db.refresh(row)
    return _detail(row)


def close_gap(db: Session, order_id: str, gap_id: str, *, role: str, fio: str, note: str) -> dict:
    row = _order(db, order_id)
    item = next((gap for gap in row.gaps if gap.id == gap_id), None)
    if item is None:
        raise ExternalOrderError("Пробел не найден", 404)
    if item.status != "open":
        raise ExternalOrderError("Пробел уже закрыт", 409)
    _require_owner(role, item.owner_role, "пробел")
    answer = (note or "").strip()
    if not answer:
        raise ExternalOrderError("Нужен ответ владельца: значение и источник", 400)
    item.status = "closed"
    item.detail = f"{item.detail} · закрыто: {answer}"
    _audit(db, row, fio=fio, role=role, action="close_gap", detail=item.field, before="открыт", after=answer)
    db.commit()
    db.refresh(row)
    return _detail(row)


def add_risk(db: Session, order_id: str, *, role: str, fio: str, fields: dict) -> dict:
    row = _order(db, order_id)
    _require_business(role)
    if role not in {"rp", "ks", "production", "finance"}:
        raise ExternalOrderError("Риск регистрирует руководитель проекта или владелец области", 403)
    title = str(fields.get("title") or "").strip()
    if not title:
        raise ExternalOrderError("Нужно название риска", 400)
    db.add(
        ExternalOrderRisk(
            id=_new_id(),
            order_id=row.id,
            title=title,
            impact=str(fields.get("impact") or ""),
            measure=str(fields.get("measure") or ""),
            source=str(fields.get("source") or ""),
            created_by=fio,
        )
    )
    _audit(db, row, fio=fio, role=role, action="risk", detail=title)
    db.commit()
    db.refresh(row)
    return _detail(row)


def add_decision(db: Session, order_id: str, *, role: str, fio: str, fields: dict) -> dict:
    row = _order(db, order_id)
    if role != "committee":
        raise ExternalOrderError("Решение Комитета фиксирует только Комитет", 403)
    decision = str(fields.get("decision") or "")
    if decision not in {"confirmed", "confirmed_conditions", "rework"}:
        raise ExternalOrderError("Неизвестное решение", 400)
    protocol = str(fields.get("protocol") or "").strip()
    base_version = str(fields.get("base_version") or "").strip()
    baseline_id = str(fields.get("baseline_id") or "").strip()
    from app.services.external_order_case import lock_baseline

    if decision != "rework" and not protocol:
        raise ExternalOrderError("Нужны протокол и базовая версия", 400)
    baseline = lock_baseline(row, baseline_id, base_version) if decision != "rework" else None
    closed = decision == "confirmed"
    db.add(
        ExternalOrderDecision(
            id=_new_id(),
            order_id=row.id,
            protocol=protocol,
            decision=decision,
            allowed_stage=str(fields.get("allowed_stage") or "tkp"),
            conditions=str(fields.get("conditions") or ""),
            conditions_closed=closed,
            base_version=baseline.code if baseline is not None else "",
            baseline_id=baseline.id if baseline is not None else "",
            decided_by=fio,
        )
    )
    if decision == "rework":
        row.status = "rework"
    elif decision == "confirmed":
        row.status = "confirmed"
    else:
        row.status = "confirmed_conditions"
    row.stage = "calc"
    _audit(db, row, fio=fio, role=role, action="decision", detail=protocol or decision)
    db.commit()
    db.refresh(row)
    return _detail(row)


def close_conditions(
    db: Session,
    order_id: str,
    decision_id: str,
    *,
    role: str,
    fio: str,
    document_id: str = "",
) -> dict:
    from app.services.external_order_case import notify

    row = _order(db, order_id)
    if role != "committee":
        raise ExternalOrderError("Условия закрывает Комитет", 403)
    item = next((decision for decision in row.decisions if decision.id == decision_id), None)
    if item is None:
        raise ExternalOrderError("Решение не найдено", 404)
    document = next((doc for doc in row.documents if doc.id == document_id), None)
    if document is None or document.owner_role in {"", "committee"}:
        _audit(db, row, fio=fio, role=role, action="conditions_rejected", detail=item.protocol or decision_id)
        notify(
            db,
            row,
            kind="condition",
            role="committee",
            title="Условие не закрыто",
            body="Нет документа владельца заключения",
        )
        db.commit()
        raise ExternalOrderError("Закрытие условия отклонено: нет документа владельца заключения", 409)
    item.conditions_closed = True
    _audit(
        db,
        row,
        fio=fio,
        role=role,
        action="conditions_closed",
        detail=item.protocol,
        before="открыто",
        after=document.title,
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def add_document(db: Session, order_id: str, *, role: str, fio: str, fields: dict) -> dict:
    row = _order(db, order_id)
    if role not in {"ks", "development", "rp", "legal"}:
        raise ExternalOrderError("Документ в дело кладёт коммерческая служба, развитие, РП или юрист", 403)
    title = str(fields.get("title") or "").strip()
    if not title:
        raise ExternalOrderError("Нужно название документа", 400)
    db.add(
        ExternalOrderDocument(
            id=_new_id(),
            order_id=row.id,
            kind=str(fields.get("kind") or "other"),
            title=title,
            version=str(fields.get("version") or ""),
            note=str(fields.get("note") or ""),
        )
    )
    _audit(db, row, fio=fio, role=role, action="document", detail=title)
    db.commit()
    db.refresh(row)
    return _detail(row)


def _draft_findings_in_session(db: Session, order: ExternalOrder) -> list[ExternalOrderFinding]:
    rows = {id(item): item for item in order.findings}
    for item in db.new:
        if isinstance(item, ExternalOrderFinding) and item.order_id == order.id:
            rows[id(item)] = item
    return [item for item in rows.values() if item.status == "draft"]


_EMPTY_WORDS = {
    "пусто",
    "пустым",
    "пустое",
    "не заполнять",
    "оставить пустым",
    "оставь пустым",
    "оставь поле пустым",
    "н/п",
    "не применимо",
}


def _blank_reason(item: dict) -> str:
    """Сотрудник просит оставить поле пустым: это решение, а не текст для карточки."""
    reason = str(item.get("empty_reason") or "").strip()
    if item.get("empty") is True or (item.get("value") is None and reason):
        return reason or "решение сотрудника"
    folded = str(item.get("value") or "").strip().casefold().strip(" .")
    if folded in _EMPTY_WORDS or folded.startswith("оставить пуст"):
        return reason or "решение сотрудника"
    return ""


def _upsert_draft_finding(
    db: Session,
    order: ExternalOrder,
    *,
    field: str,
    value: str,
    source_ref: str,
    location: str,
    owner_role: str,
    proposed_by: str,
    document_id: str = "",
    confidence: str = "авто",
) -> ExternalOrderFinding | None:
    clean_field = str(field or "").strip()[:128]
    clean_value = str(value or "").strip()[:2000]
    if not clean_field or not clean_value:
        return None
    for existing in _draft_findings_in_session(db, order):
        if existing.field == clean_field:
            existing.value = clean_value
            if source_ref:
                existing.source_ref = str(source_ref)[:512]
            if location:
                existing.location = str(location)[:2000]
            if owner_role:
                existing.owner_role = str(owner_role)[:32]
            return existing
    if any(
        item.field == clean_field and item.status == "accepted" and item.value == clean_value
        for item in order.findings
    ):
        return None
    finding = ExternalOrderFinding(
        id=_new_id(),
        order_id=order.id,
        field=clean_field,
        value=clean_value,
        source_ref=str(source_ref or "авто-проверка")[:512],
        location=str(location or "карточка заказа")[:2000],
        document_id=str(document_id or ""),
        confidence=str(confidence or "")[:16],
        status="draft",
        owner_role=str(owner_role or "ks")[:32],
        proposed_by=str(proposed_by or "агент")[:512],
    )
    db.add(finding)
    return finding


def propose(
    db: Session,
    order_id: str,
    *,
    fio: str,
    findings: list | None = None,
    diffs: list | None = None,
    section_proposals: list | None = None,
    check_proposals: list | None = None,
    baseline_proposal: dict | None = None,
    risk_proposals: list | None = None,
) -> dict:
    """Черновики агента. Фактом они становятся только после «Принять» владельцем."""
    row = _order(db, order_id)
    created = 0
    skipped: list[dict[str, str]] = []
    unchanged: list[str] = []

    def _same_draft(field: str, value: str) -> bool:
        for item in list(row.findings):
            if item.field != field or str(item.value or "") != value:
                continue
            if item.status == "draft":
                return True
            if item.status == "accepted" and str(item.confidence or "") == "empty":
                return True
        return False

    for item in findings or []:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "").strip()
        value = str(item.get("value") or "").strip()
        source = str(item.get("source_ref") or "").strip()
        location = str(item.get("location") or "").strip()
        if not field or not value or not source:
            continue
        if not location:
            from app.services.external_order_case import add_gap

            add_gap(
                db,
                row,
                field=field,
                owner_role=str(item.get("owner_role") or "ks"),
                detail="Вывод без места в источнике не сохранён",
            )
            continue
        added = _upsert_draft_finding(
            db,
            row,
                field=field,
                value=value,
                source_ref=source,
                location=location,
                document_id=str(item.get("document_id") or ""),
                confidence=str(item.get("confidence") or ""),
                owner_role=str(item.get("owner_role") or "ks"),
                proposed_by=fio or "агент",
            )
        if added is not None:
            created += 1
    for item in section_proposals or []:
        if not isinstance(item, dict):
            continue
        sec = str(item.get("section") or "").strip()
        key = str(item.get("key") or "").strip()
        raw_field = str(item.get("field") or "").strip()
        if (not sec or not key) and "." in raw_field:
            cleaned = raw_field[len("section:"):] if raw_field.startswith("section:") else raw_field
            sec, key = cleaned.split(".", 1)
        value = str(item.get("value") or "").strip()
        blank = _blank_reason(item)
        if not sec or not key or (not value and not blank):
            skipped.append(
                {
                    "field": f"section:{sec}.{key}" if sec and key else str(item.get("field") or ""),
                    "reason": "Пустое значение без пометки empty не записывается. Текст «пусто» подставлять нельзя.",
                }
            )
            continue
        if blank:
            value = f"Поле оставлено пустым: {blank}"[:2000]
            item = {**item, "confidence": "empty"}
        field_name = f"section:{sec}.{key}"
        if _same_draft(field_name, value):
            unchanged.append(field_name)
            continue
        owner = str(item.get("owner_role") or _section_field_owner(sec, key))
        added = _upsert_draft_finding(
            db,
            row,
            field=f"section:{sec}.{key}",
            value=value,
            source_ref=str(item.get("source_ref") or "предложение ИИ"),
            location=str(item.get("location") or f"раздел {sec}.{key}"),
            confidence=str(item.get("confidence") or "черновик"),
            owner_role=owner,
            proposed_by=fio or "агент",
        )
        if added is not None:
            created += 1
    for item in check_proposals or []:
        if not isinstance(item, dict):
            continue
        check_id = str(item.get("check_id") or item.get("id") or "").strip()
        if check_id.startswith("check:"):
            check_id = check_id[len("check:"):].strip()
        evidence = str(item.get("evidence") or item.get("value") or "").strip()
        if not check_id or not evidence:
            continue
        chk = next((c for c in row.checks if c.id == check_id), None)
        owner = str(item.get("owner_role") or (chk.owner_role if chk is not None else "ks"))
        added = _upsert_draft_finding(
            db,
            row,
            field=f"check:{check_id}",
            value=evidence,
            source_ref=str(item.get("source_ref") or "предложение ИИ"),
            location=str(item.get("location") or "чек-лист этапа"),
            confidence=str(item.get("confidence") or "черновик"),
            owner_role=owner,
            proposed_by=fio or "агент",
        )
        if added is not None:
            created += 1
    if isinstance(baseline_proposal, dict) and any(str(v or "").strip() for v in baseline_proposal.values()):
        payload = {
            key: str(baseline_proposal.get(key) or "").strip()
            for key in ("composition", "cost", "mcr", "margin", "bdds", "deadlines", "reason")
            if str(baseline_proposal.get(key) or "").strip()
        }
        if payload:
            added = _upsert_draft_finding(
                db,
                row,
                field="baseline:draft",
                value=_dump(payload),
                source_ref=str(baseline_proposal.get("source_ref") or "расчёт базовой версии"),
                location=str(baseline_proposal.get("location") or "базовая версия Комитета"),
                confidence="черновик",
                owner_role=str(baseline_proposal.get("owner_role") or "finance"),
                proposed_by=fio or "агент",
            )
            if added is not None:
                created += 1
    for item in risk_proposals or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("value") or "").strip()
        if not title:
            continue
        risk_payload = {
            "title": title,
            "impact": str(item.get("impact") or "").strip(),
            "measure": str(item.get("measure") or "").strip(),
            "source": str(item.get("source") or item.get("source_ref") or "анализ ИИ").strip(),
        }
        added = _upsert_draft_finding(
            db,
            row,
            field="risk:draft",
            value=_dump(risk_payload),
            source_ref=risk_payload["source"],
            location="реестр рисков",
            confidence="черновик",
            owner_role=str(item.get("owner_role") or "rp"),
            proposed_by=fio or "агент",
        )
        if added is not None:
            created += 1
    for item in diffs or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip()
        match = next((diff for diff in row.diffs if diff.code == code), None)
        if match is None or match.status == "closed":
            continue
        match.left_value = str(item.get("left_value") or match.left_value)
        match.right_value = str(item.get("right_value") or match.right_value)
        match.note = str(item.get("note") or "")
        match.status = "draft"
        created += 1
    if created:
        _audit(db, row, fio=fio or "агент", role="agent", action="propose", detail=f"черновиков: {created}")
    db.commit()
    db.refresh(row)
    body = _detail(row)
    body["proposed"] = created
    body["skipped"] = skipped
    body["unchanged"] = unchanged
    if created:
        body["note"] = "Черновик не является фактом, пока владелец не нажмёт «Принять»."
    elif unchanged:
        body["note"] = "Такой черновик уже есть. Повторно его не записываю."
    elif skipped:
        body["note"] = skipped[0]["reason"]
    else:
        body["note"] = "Черновик не записан: в вызове не было поля и значения."
    return body


def _parse_kv_or_json(raw: str) -> dict[str, str]:
    parsed = _load(raw)
    if parsed:
        return {str(k).strip(): str(v or "").strip() for k, v in parsed.items()}
    out: dict[str, str] = {}
    for chunk in str(raw or "").replace("\n", ";").split(";"):
        part = chunk.strip()
        if not part:
            continue
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip().casefold()] = v.strip()
        elif "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().casefold()] = v.strip()
    return out


def _apply_finding_effect(db: Session, row: ExternalOrder, item: ExternalOrderFinding, *, role: str, fio: str) -> None:
    from app.services.external_order_case import create_baseline, resolve_gaps

    field = str(item.field or "").strip()
    val = str(item.value or "").strip()
    if field.startswith("section:"):
        if str(item.confidence or "") == "empty":
            return
        target = field[len("section:"):].strip()
        if "." in target and val:
            sec, key = target.split(".", 1)
            sections = _load(row.sections_json)
            bucket = dict(sections.get(sec) or {})
            bucket[key] = val
            sections[sec] = bucket
            row.sections_json = _dump(sections)
            resolve_gaps(db, row, key, val)
            resolve_gaps(db, row, field, val)
            resolve_gaps(db, row, f"{sec}.{key}", val)
        return
    if field.startswith("check:"):
        cid = field[len("check:"):].strip()
        chk = next((c for c in row.checks if c.id == cid), None)
        if chk is not None:
            chk.status = "done"
            chk.evidence = val or item.source_ref or "Подтверждено по выводу ИИ"
            chk.confirmed_by = fio
        return
    if field.startswith("baseline:"):
        kv = _parse_kv_or_json(val)
        sections = _load(row.sections_json)
        calc = sections.get("calculation") if isinstance(sections.get("calculation"), dict) else {}
        comm = sections.get("commercial") if isinstance(sections.get("commercial"), dict) else {}
        tech = sections.get("technical") if isinstance(sections.get("technical"), dict) else {}
        proj = sections.get("project") if isinstance(sections.get("project"), dict) else {}
        baseline_fields = {
            "composition": (
                kv.get("composition")
                or kv.get("состав")
                or str(tech.get("composition") or "")
                or row.product
            ),
            "cost": (
                kv.get("cost")
                or kv.get("себестоимость")
                or kv.get("стоимость")
                or str(calc.get("cost") or comm.get("price") or "")
            ),
            "mcr": kv.get("mcr") or kv.get("мцр") or str(calc.get("mcr") or ""),
            "margin": kv.get("margin") or kv.get("маржа") or str(calc.get("margin") or ""),
            "bdds": kv.get("bdds") or kv.get("бддс") or str(calc.get("bdds") or ""),
            "deadlines": (
                kv.get("deadlines")
                or kv.get("сроки")
                or kv.get("срок")
                or str(proj.get("plan_note") or "")
            ),
            "reason": kv.get("reason") or kv.get("основание") or item.source_ref or "Принято из черновика ИИ",
        }
        labels = {
            "composition": "состав",
            "cost": "стоимость",
            "mcr": "МЦР",
            "margin": "маржа",
            "bdds": "БДДС",
            "deadlines": "сроки",
        }
        missing = [label for key, label in labels.items() if not str(baseline_fields.get(key) or "").strip()]
        if missing:
            raise ExternalOrderError(
                "Базовая версия не собрана: нет "
                + ", ".join(missing)
                + ". Заполните их на вкладке «Комитет и БВ» и нажмите «Собрать базовую версию».",
                400,
            )
        effective_role = role if role in {"ks", "finance", "rp", "committee"} else "finance"
        create_baseline(db, row, role=effective_role, fio=fio, fields=baseline_fields)
        return
    if field.startswith("risk:"):
        kv = _parse_kv_or_json(val)
        title = kv.get("title") or kv.get("название") or kv.get("риск") or val
        if title:
            db.add(
                ExternalOrderRisk(
                    id=_new_id(),
                    order_id=row.id,
                    title=str(title)[:512],
                    impact=str(kv.get("impact") or kv.get("влияние") or ""),
                    measure=str(kv.get("measure") or kv.get("мера") or ""),
                    source=str(kv.get("source") or kv.get("источник") or item.source_ref or "черновик ИИ"),
                    created_by=fio,
                )
            )
        return
    if val:
        resolve_gaps(db, row, field, val)


def accept_finding(db: Session, order_id: str, finding_id: str, *, role: str, fio: str) -> dict:
    row = _order(db, order_id)
    item = next((finding for finding in row.findings if finding.id == finding_id), None)
    if item is None:
        raise ExternalOrderError("Вывод не найден", 404)
    _require_owner(role, item.owner_role or role, "вывод агента")
    _apply_finding_effect(db, row, item, role=role, fio=fio)
    item.status = "accepted"
    if fio and "подтвердил" not in str(item.proposed_by or ""):
        item.proposed_by = f"{item.proposed_by} · подтвердил {fio}"[:512]
    _audit(db, row, fio=fio, role=role, action="accept_finding", detail=item.field, after=item.value[:200])
    db.commit()
    db.refresh(row)
    return _detail(row)


def accept_role_findings(db: Session, order_id: str, *, role: str, fio: str) -> dict:
    row = _order(db, order_id)
    _require_business(role)
    drafts = [item for item in row.findings if item.status == "draft"]
    owned = [
        item
        for item in drafts
        if item.owner_role == role or (not item.owner_role and role in {"ks", "rp"})
    ]
    # Черновики ИИ принимает только владелец раздела, без подстановки КС или РП.
    fallback = [item for item in drafts if not is_ai_finding(item.proposed_by, item.confidence)]
    targets = owned if owned else (fallback if role in {"ks", "rp"} else [])
    accepted_count = 0
    for item in targets:
        _apply_finding_effect(db, row, item, role=item.owner_role or role, fio=fio)
        item.status = "accepted"
        accepted_count += 1
    _audit(
        db,
        row,
        fio=fio,
        role=role,
        action="accept_role_findings",
        detail=f"{ROLES.get(role, role)}: принято {accepted_count}",
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def reject_finding(
    db: Session, order_id: str, finding_id: str, *, role: str, fio: str, reason: str = ""
) -> dict:
    row = _order(db, order_id)
    _require_business(role)
    item = next((finding for finding in row.findings if finding.id == finding_id), None)
    if item is None:
        raise ExternalOrderError("Вывод не найден", 404)
    if role not in {item.owner_role, "ks", "rp"}:
        raise ExternalOrderError("Нельзя отклонить вывод чужой роли", 403)
    why = (reason or "").strip()
    item.status = "rejected"
    _audit(
        db,
        row,
        fio=fio,
        role=role,
        action="eval_reject",
        detail=f"{item.field} · {why}"[:500],
        before=item.value[:200],
        after="отклонено",
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def correct_finding(
    db: Session,
    order_id: str,
    finding_id: str,
    *,
    role: str,
    fio: str,
    value: str,
    reason: str = "",
) -> dict:
    """Исправление человека остаётся черновиком и попадает в журнал оценки."""
    row = _order(db, order_id)
    _require_business(role)
    item = next((finding for finding in row.findings if finding.id == finding_id), None)
    if item is None:
        raise ExternalOrderError("Вывод не найден", 404)
    if role not in {item.owner_role, "ks", "rp"}:
        raise ExternalOrderError("Нельзя исправить вывод чужой роли", 403)
    corrected = (value or "").strip()
    if not corrected:
        raise ExternalOrderError("Нет исправленного значения", 400)
    before = item.value[:200]
    item.value = corrected[:4000]
    item.status = "draft"
    why = (reason or "").strip()
    _audit(
        db,
        row,
        fio=fio,
        role=role,
        action="eval_correct",
        detail=f"{item.field} · {why}"[:500],
        before=before,
        after=corrected[:200],
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


_ALLOWED_DRAFT_1C_KINDS = {"memo", "assignment", "directive", "order", "protocol"}
_DRAFT_1C_OWNER = {
    "memo": "ks",
    "assignment": "rp",
    "directive": "rp",
    "order": "rp",
    "protocol": "committee",
}


def draft_onec(db: Session, order_id: str, *, fio: str, fields: dict) -> dict:
    """Готовит черновик документа 1С. Саму запись делает onec.docflow_document_create после подтверждения."""
    row = _order(db, order_id)
    kind = str(fields.get("kind") or "").strip()
    if kind not in _ALLOWED_DRAFT_1C_KINDS:
        raise ExternalOrderError(
            "В 1С из этого модуля уходит только черновик записки, поручения, распоряжения, приказа или протокола",
            400,
        )
    title = str(fields.get("title") or "").strip()
    text = str(fields.get("text") or "").strip()
    if not title or not text:
        raise ExternalOrderError("Нужны заголовок и текст черновика", 400)
    raw_prefill = fields.get("prefill") if isinstance(fields.get("prefill"), dict) else {}
    prefill = {
        "kind": kind,
        "title": title,
        "text": text,
        "order_id": row.id,
        "order_code": row.code,
        "customer": row.customer,
        "product": row.product,
        **{str(k): v for k, v in raw_prefill.items()},
    }
    owner_role = str(fields.get("owner_role") or _DRAFT_1C_OWNER.get(kind, "ks"))
    _upsert_draft_finding(
        db,
        row,
            field=f"draft_1c_{kind}",
            value=text,
            source_ref=title,
        location=_dump(prefill),
        confidence="черновик",
        owner_role=owner_role,
            proposed_by=fio or "агент",
    )
    _audit(db, row, fio=fio or "агент", role="agent", action="draft_1c", detail=f"{kind}: {title}")
    db.commit()
    return {
        "ok": True,
        "draft": True,
        "kind": kind,
        "title": title,
        "text": text,
        "prefill": prefill,
        "note": (
            "Это черновик, в 1С он ещё не записан. "
            "Следующий шаг — onec.docflow_document_create action=create. "
            "Человек подтверждает отправку."
        ),
    }


def _can_write_section(role: str, section: str, values: dict) -> bool:
    try:
        _guard_section(role, section, values)
        return True
    except ExternalOrderError:
        return False


_SURVEY_DRAFTS = (
    ("ндс", "commercial", "vat", "ks"),
    ("цена", "commercial", "price", "ks"),
    ("сумма", "commercial", "price", "ks"),
    ("валют", "commercial", "currency", "ks"),
    ("скидк", "commercial", "discount", "ks"),
    ("срок", "project", "plan_note", "rp"),
    ("оплат", "finance", "schedule", "finance"),
    ("гаранти", "contract", "warranty", "legal"),
    ("санкц", "contract", "sanctions", "legal"),
    ("состав", "technical", "composition", "kb"),
)


def _draft_survey_sheet(db: Session, row: ExternalOrder, sections: dict) -> None:
    """Черновик пустого поля из опросного листа. Уже записанный черновик 1С не затирает."""
    from app.services.external_order_case import survey_sheet_lines

    taken = {item.field for item in row.findings if item.status == "draft"}
    for line in survey_sheet_lines(row):
        label, _, value = line.partition(":")
        value = value.strip()
        folded = label.casefold().replace("ё", "е")
        if not value:
            continue
        for token, sec, key, owner in _SURVEY_DRAFTS:
            if token not in folded:
                continue
            field = f"section:{sec}.{key}"
            current = sections.get(sec) if isinstance(sections.get(sec), dict) else {}
            if field in taken or str((current or {}).get(key) or "").strip():
                break
            _upsert_draft_finding(
                db,
                row,
                field=field,
                value=value,
                source_ref="Опросный лист",
                location=label.strip()[:200],
                owner_role=owner,
                proposed_by="опросный лист",
            )
            taken.add(field)
            break


def auto_prepare_order(
    db: Session,
    row: ExternalOrder,
    *,
    role: str = "ks",
    fio: str = "",
    step_id: str = "",
) -> list[str]:
    """Детерминированная предобработка заказа до вызова LLM: синхронизация 1С, черновики полей, чек-листов и 1С ДО."""
    from app.services.external_order_case import _UPLOAD_ROLES, refresh_overdue

    log: list[str] = []
    refresh_overdue(db, row)

    # 1. Мягкая синхронизация 1С (без падения при недоступности 1С).
    # Соединение отдаём в пул до запросов в 1С: иначе несколько агентов держат
    # все 15 соединений и следующий запрос падает по таймауту пула.
    onec = _onec_link(row)
    tkp_key = str(onec.get("tkp_key") or "").strip()
    ref_key = str(onec.get("order_key") or "").strip()
    if tkp_key or ref_key:
        order_id = row.id
        _release_db(db)
        traced: dict | None = None
        unavailable = False
        try:
            from app.services.external_order_onec import read_order, tkp_key_for_order, trace_tkp

            traced = trace_tkp(tkp_key) if tkp_key else _trace_or_order(ref_key, read_order, tkp_key_for_order, trace_tkp)
        except Exception:  # noqa: BLE001
            unavailable = True
        row = _order(db, order_id)
        if unavailable:
            log.append("1С сейчас недоступна — использованы сохранённые реквизиты карточки")
        elif isinstance(traced, dict) and traced:
            _apply_onec(row, traced)
            _remember_tkp_terms(row, traced=True)
            onec = _onec_link(row)
            log.append(f"Обновлена цепочка 1С: {_path_label(row) or _payment_note(row)}")

    sections = _load(row.sections_json)
    owners = _load(row.owners_json)
    comm = sections.get("commercial") if isinstance(sections.get("commercial"), dict) else {}
    tech = sections.get("technical") if isinstance(sections.get("technical"), dict) else {}
    calc = sections.get("calculation") if isinstance(sections.get("calculation"), dict) else {}
    fin = sections.get("finance") if isinstance(sections.get("finance"), dict) else {}
    proj = sections.get("project") if isinstance(sections.get("project"), dict) else {}
    exec_sec = sections.get("execution") if isinstance(sections.get("execution"), dict) else {}
    contract_sec = sections.get("contract") if isinstance(sections.get("contract"), dict) else {}

    # 2. Черновики полей разделов из 1С и файлов дела
    if onec.get("amount") and not str(comm.get("price") or "").strip():
        num = onec.get("order_number") or onec.get("tkp_number") or "ERP"
        _upsert_draft_finding(
            db,
            row,
            field="section:commercial.price",
            value=f"{onec['amount']} руб.",
            source_ref=f"1С заказ {num}",
            location="реквизит СуммаДокумента",
            owner_role="ks",
            proposed_by="авто-проверка 1С",
        )
        log.append(f"Предложена цена из 1С ({onec['amount']} руб.)")

    if not str(comm.get("currency") or "").strip():
        currency = str(onec.get("currency") or "").strip()
        _upsert_draft_finding(
            db,
            row,
            field="section:commercial.currency",
            value=currency or "RUB",
            source_ref="1С ТКП" if currency else f"Карточка {row.code}",
            location="валюта ТКП" if currency else "валюта расчётов по умолчанию",
            owner_role="ks",
            proposed_by="авто-проверка 1С" if currency else "авто-проверка",
        )

    if str(onec.get("vat") or "").strip() and not str(comm.get("vat") or "").strip():
        _upsert_draft_finding(
            db,
            row,
            field="section:commercial.vat",
            value=str(onec.get("vat")),
            source_ref=f"1С ТКП {onec.get('tkp_number') or ''}".strip(),
            location="НалогообложениеНДС",
            owner_role="ks",
            proposed_by="авто-проверка 1С",
        )
        log.append(f"НДС взят из ТКП: {onec.get('vat')}")

    if str(onec.get("delivery_days") or "").strip() and not str(proj.get("plan_note") or "").strip():
        _upsert_draft_finding(
            db,
            row,
            field="section:project.plan_note",
            value=f"Срок поставки: {onec.get('delivery_days')}",
            source_ref=f"1С ТКП {onec.get('tkp_number') or ''}".strip(),
            location="СрокПоставки",
            owner_role="rp",
            proposed_by="авто-проверка 1С",
        )

    if (onec.get("paid") or onec.get("amount")) and not str(fin.get("schedule") or "").strip():
        num = onec.get("order_number") or "ERP"
        _upsert_draft_finding(
            db,
            row,
            field="section:finance.schedule",
            value=f"1С заказ {num}: оплачено {onec.get('paid') or '0'} из {onec.get('amount') or '0'} ({row.payment_percent}%)",
            source_ref=f"1С заказ {num}",
            location="поступления по заказу",
            owner_role="finance",
            proposed_by="авто-проверка 1С",
        )

    # Извлечённые выводы из документов (.docx) -> черновики разделов
    doc_to_section = {
        "price": ("commercial", "price", "ks"),
        "vat": ("commercial", "vat", "ks"),
        "term": ("project", "plan_note", "rp"),
        "payment": ("calculation", "bdds", "finance"),
        "acceptance": ("execution", "acceptance", "production"),
        "warranty": ("contract", "warranty", "legal"),
        "sanctions": ("contract", "sanctions", "legal"),
        "subject": ("technical", "composition", "kb"),
    }
    for f_item in list(row.findings):
        mapped = doc_to_section.get(f_item.field)
        if not mapped or not str(f_item.value or "").strip():
            continue
        sec_name, sec_key, sec_owner = mapped
        cur_sec = sections.get(sec_name) if isinstance(sections.get(sec_name), dict) else {}
        if str(cur_sec.get(sec_key) or "").strip():
            continue
        _upsert_draft_finding(
            db,
            row,
            field=f"section:{sec_name}.{sec_key}",
            value=f_item.value,
            source_ref=f_item.source_ref or "документ дела",
            location=f_item.location or "текст документа",
            document_id=f_item.document_id,
            owner_role=sec_owner,
            proposed_by="разбор документов",
        )

    if not str(tech.get("composition") or "").strip():
        if list(row.lines):
            comp_str = "; ".join(
                f"{line.name} ({line.qty})" if line.qty else line.name for line in list(row.lines)[:8]
            )
            _upsert_draft_finding(
                db,
                row,
                field="section:technical.composition",
                value=comp_str,
                source_ref="Спецификация дела",
                location="таблица позиций",
                owner_role="kb",
                proposed_by="разбор спецификации",
            )
            log.append("Сформирован черновик состава изделия по таблице спецификации")
        elif row.product:
            _upsert_draft_finding(
                db,
                row,
                field="section:technical.composition",
                value=f"{row.product} (по запросу {row.code})",
                source_ref=f"Карточка {row.code}",
                location="паспорт заказа",
                owner_role="kb",
                proposed_by="авто-проверка",
            )

    _draft_survey_sheet(db, row, sections)

    # 3. Авто-предложения доказательств по открытым пунктам чек-листа
    tz_docs = [doc for doc in row.documents if doc.kind == "tz"]
    for chk in row.checks:
        if chk.status in {"done", "not_applicable"}:
            continue
        text = chk.text
        evidence = ""
        source_ref = f"Карточка {row.code}"
        if text == "Заказчик и продукт идентифицированы" and row.customer and row.product:
            inn_note = f", ИНН {row.inn}" if row.inn else ""
            evidence = f"Заказчик: {row.customer}{inn_note}; продукт: {row.product}"
        elif text == "Запрос и ТЗ зарегистрированы" and row.code:
            if tz_docs:
                evidence = f"Запрос {row.code}, прикреплён файл ТЗ «{tz_docs[-1].title}» ({tz_docs[-1].version})"
                source_ref = tz_docs[-1].title
            else:
                evidence = f"Карточка запроса {row.code} зарегистрирована ({row.customer} — {row.product})"
        elif text == "Назначены КС и РП" and owners.get("ks") and owners.get("rp"):
            evidence = f"Назначены КС ({owners['ks']}) и РП ({owners['rp']})"
        elif text == "Выбран маршрут" and row.route:
            evidence = f"Маршрут: {ROUTES.get(row.route, row.route)} ({row.route})"
        elif text == "Состав и КД определены" and (tech.get("composition") or list(row.lines)):
            evidence = f"Состав: {tech.get('composition') or 'по спецификации дела'}; КД: {tech.get('kd') or 'подтверждено'}"
        elif text == "Производство подтвердило цикл и мощности" and exec_sec.get("cycle") and exec_sec.get("capacity"):
            evidence = f"Цикл: {exec_sec['cycle']}, мощности: {exec_sec['capacity']}"
        elif text == "Рассчитаны МЦР, маржа, резерв и БДДС" and calc.get("mcr") and calc.get("margin"):
            evidence = f"МЦР: {calc['mcr']}, маржа: {calc['margin']}, БДДС: {calc.get('bdds') or 'согласован'}"
        elif text == "Есть разрешающий протокол и базовая версия" and list(row.decisions) and list(row.baselines):
            evidence = f"Протокол {row.decisions[-1].protocol}, базовая версия {row.baselines[-1].code}"
        elif text == "Юристы подтвердили свою область" and contract_sec.get("warranty") and contract_sec.get("sanctions"):
            evidence = f"Гарантия: {contract_sec['warranty']}; санкции: {contract_sec['sanctions']}"
        elif text == "Создано электронное дело" and row.code:
            evidence = f"Электронное дело {row.code} активно"
        elif text == "Получено 100 процентов оплаты" and row.payment_percent >= 100:
            evidence = f"Оплата 100% ({_payment_note(row)})"
        if evidence:
            _upsert_draft_finding(
                db,
                row,
                field=f"check:{chk.id}",
                value=evidence,
                source_ref=source_ref,
                location=f"гейт {_GATE_LABEL.get(chk.gate, chk.gate)}",
                owner_role=chk.owner_role,
                proposed_by="авто-проверка",
            )

    # 4. Черновик базовой версии, если есть расчётные данные и ещё нет БВ
    if not list(row.baselines) and (
        calc.get("cost") or comm.get("price") or onec.get("amount") or role in {"finance", "committee"} or step_id == "committee"
    ):
        # Чего нет в деле, остаётся пустым: МЦР, маржу и сроки заполняют службы.
        base_draft = {
            "composition": str(tech.get("composition") or row.product or ""),
            "cost": str(calc.get("cost") or comm.get("price") or onec.get("amount") or ""),
            "mcr": str(calc.get("mcr") or ""),
            "margin": str(calc.get("margin") or ""),
            "bdds": str(calc.get("bdds") or fin.get("schedule") or ""),
            "deadlines": str(proj.get("plan_note") or exec_sec.get("cycle") or ""),
            "reason": f"Первичная сборка базовой версии по заказу {row.code}",
        }
        _upsert_draft_finding(
            db,
            row,
            field="baseline:draft",
            value=_dump(base_draft),
            source_ref=f"Расчёт по заказу {row.code}",
            location="панель Комитета",
            owner_role="finance" if role == "finance" else ("committee" if role == "committee" else "finance"),
            proposed_by="авто-проверка",
        )

    # 5. Черновик документа 1С ДО по текущему шагу или службе
    doc_kind = "memo"
    doc_owner = role if role in _UPLOAD_ROLES else "ks"
    doc_title = f"СЗ по внешнему заказу {row.code} ({row.customer} — {row.product})"
    doc_text = (
        f"По внешнему заказу {row.code} ({row.customer}, изделие «{row.product}», этап «{STATUSES.get(row.status, row.status)}») "
        f"прошу рассмотреть материалы дела и подтвердить заключение службы «{ROLES.get(doc_owner, doc_owner)}»."
    )
    if step_id == "committee" or role == "committee":
        doc_kind = "protocol"
        doc_owner = "committee"
        doc_title = f"Протокол Комитета по внешнему заказу {row.code} ({row.product})"
        doc_text = (
            f"Комитет по расчёту стоимости внешних несерийных заказов рассмотрел заказ {row.code} "
            f"({row.customer}, {row.product}). Решение: утвердить базовую версию расчёта и разрешить выпуск ТКП."
        )
    elif step_id == "start":
        doc_kind = "directive"
        doc_owner = "rp"
        doc_title = f"Распоряжение о начале проекта {row.code} ({row.product})"
        doc_text = (
            f"Запустить в работу несерийный заказ {row.code} для заказчика {row.customer} "
            f"(изделие: {row.product}). Начальнику цеха несерийного оборудования обеспечить график изготовления."
        )
    elif role == "rp":
        doc_kind = "assignment"
        doc_owner = "rp"
        doc_title = f"Поручение по внешнему заказу {row.code} ({row.product})"
        doc_text = (
            f"По внешнему заказу {row.code} ({row.customer}) подготовить и закрыть обязательства по критическому пути проекта."
        )
    prefill = {
        "kind": doc_kind,
        "title": doc_title,
        "text": doc_text,
        "order_id": row.id,
        "order_code": row.code,
        "customer": row.customer,
        "product": row.product,
    }
    _upsert_draft_finding(
        db,
        row,
        field=f"draft_1c_{doc_kind}",
        value=doc_text,
        source_ref=doc_title,
        location=_dump(prefill),
        owner_role=doc_owner,
        proposed_by=fio or "авто-проверка",
    )
    log.append(f"Авто-подготовка завершена для роли «{ROLES.get(role, role)}»")
    return log


def run_copilot(
    db: Session,
    order_id: str,
    *,
    role: str,
    fio: str,
    step_id: str = "",
    message: str = "",
    answers: dict[str, str] | None = None,
    auto_prepare: bool = True,
    use_ai: bool = False,
    ai_runner=None,
) -> dict:
    """Единый обработчик встроенного ИИ-помощника: применяет ответы сотрудника и запускает auto_prepare.

    use_ai — после детерминированной подготовки дело читает модель Cursor: черновики всех
    пустых полей с источником, подсказки к вопросам и проверка ответов сотрудника.
    """
    from app.services.external_order_case import resolve_gaps

    row = _order(db, order_id)
    log: list[str] = []

    # a) Применяем ответы сотрудника
    for raw_key, raw_val in (answers or {}).items():
        key = str(raw_key or "").strip()
        val = str(raw_val or "").strip()
        if not key or not val:
            continue
        if key.startswith("section:"):
            target = key[len("section:"):].strip()
            if "." in target:
                sec, field_key = target.split(".", 1)
                if _can_write_section(role, sec, {field_key: val}):
                    current = _load(row.sections_json)
                    bucket = dict(current.get(sec) or {})
                    bucket[field_key] = val
                    current[sec] = bucket
                    row.sections_json = _dump(current)
                    resolve_gaps(db, row, field_key, val)
                    resolve_gaps(db, row, key, val)
                    resolve_gaps(db, row, f"{sec}.{field_key}", val)
                    for f_item in row.findings:
                        if f_item.field == key and f_item.status == "draft":
                            f_item.status = "accepted"
                            f_item.value = val
                    _audit(db, row, fio=fio, role=role, action="copilot_answer", detail=f"{sec}.{field_key}", after=val)
                    log.append(f"Записано поле «{_section_field_label(sec, field_key)}»: {val}")
                else:
                    owner = _section_field_owner(sec, field_key)
                    _upsert_draft_finding(
                        db,
                        row,
                        field=key,
                        value=val,
                        source_ref="ответ сотрудника",
                        location="пульт помощника",
                        owner_role=owner,
                        proposed_by=fio or role,
                        confidence="ответ",
                    )
                    log.append(
                        f"Создан черновик поля «{_section_field_label(sec, field_key)}» для роли «{ROLES.get(owner, owner)}»"
                    )
        elif key.startswith("check:"):
            cid = key[len("check:"):].strip()
            chk = next((c for c in row.checks if c.id == cid), None)
            if chk is not None:
                if role == chk.owner_role and role not in {"it", "viewer"}:
                    chk.status = "done"
                    chk.evidence = val
                    chk.confirmed_by = fio
                    for f_item in row.findings:
                        if f_item.field == key and f_item.status == "draft":
                            f_item.status = "accepted"
                            f_item.value = val
                    _audit(db, row, fio=fio, role=role, action="confirm_check", detail=chk.text, after=val)
                    log.append(f"Подтверждён пункт чек-листа «{chk.text}»: {val}")
                else:
                    _upsert_draft_finding(
                        db,
                        row,
                        field=key,
                        value=val,
                        source_ref="ответ сотрудника",
                        location="пульт помощника",
                        owner_role=chk.owner_role,
                        proposed_by=fio or role,
                        confidence="ответ",
                    )
                    log.append(
                        f"Создан черновик подтверждения «{chk.text}» для роли «{ROLES.get(chk.owner_role, chk.owner_role)}»"
                    )
        elif key.startswith("gap:"):
            gid = key[len("gap:"):].strip()
            gap = next((g for g in row.gaps if g.id == gid), None)
            if gap is not None and gap.status == "open":
                if role == gap.owner_role and role not in {"it", "viewer"}:
                    gap.status = "closed"
                    gap.detail = f"{gap.detail} · закрыто: {val}"
                    _audit(db, row, fio=fio, role=role, action="close_gap", detail=gap.field, before="открыт", after=val)
                    log.append(f"Закрыт пробел «{gap.field}»: {val}")
                else:
                    _upsert_draft_finding(
                        db,
                        row,
                        field=gap.field,
                        value=val,
                        source_ref="ответ сотрудника",
                        location="пульт помощника",
                        owner_role=gap.owner_role,
                        proposed_by=fio or role,
                        confidence="ответ",
                    )
                    log.append(f"Создан черновик по пробелу «{gap.field}»")

    if (message or "").strip():
        clean_msg = message.strip()
        _audit(db, row, fio=fio or "сотрудник", role=role, action="copilot_message", detail=clean_msg[:400])
        log.append(f"Принято уточнение сотрудника: {clean_msg[:120]}")

    # b) Детерминированная предобработка
    if auto_prepare:
        prep_log = auto_prepare_order(db, row, role=role, fio=fio, step_id=step_id)
        log.extend(prep_log)

    ai: dict = {"ok": False, "error": "", "hints": {}, "answer_checks": {}}
    if use_ai:
        from app.services.external_order_ai import ai_prepare

        db.flush()
        ai = ai_prepare(db, row, role=role, answers=answers, runner=ai_runner)
        log.extend(ai.get("log") or [])
        row = _order(db, order_id)

    db.commit()
    db.refresh(row)

    # c) Формирование ответа
    detail = _detail(row)
    passports = detail.get("stage_passports") or []
    step_stage_map = {
        "zpr": "request",
        "tech": "calc",
        "analysis": "calc",
        "committee": "committee",
        "passport": "calc",
        "tkp": "tkp",
        "contract": "contract",
        "linked": "contract",
        "start": "run",
        "plan": "run",
    }
    wanted_stage = step_stage_map.get(step_id, "")
    stage_passport = (
        next((p for p in passports if p["id"] == wanted_stage), None)
        or next((p for p in passports if row.status in p.get("statuses", [])), None)
        or next((p for p in passports if p.get("state") in {"current", "blocked"}), None)
        or (passports[0] if passports else {})
    )
    all_drafts = [item for item in detail.get("findings") or [] if item.get("status") == "draft"]
    proposals = sorted(
        all_drafts,
        key=lambda item: (0 if item.get("owner_role") == role else 1, str(item.get("kind") or "")),
    )
    role_questions_map = detail.get("role_questions") or {}
    questions = list(role_questions_map.get(role) or [])
    hints = ai.get("hints") or {}
    if hints:
        questions = [{**item, **{f"ai_{k}": v for k, v in hints.get(item.get("id"), {}).items()}} for item in questions]
    other_questions = sum(len(items) for key, items in role_questions_map.items() if key != role)
    summary = _employee_brief(
        order=detail,
        role=role,
        role_label=ROLES.get(role, role),
        passport=stage_passport,
        proposals=proposals,
        questions=questions,
        other_questions=other_questions,
    )
    return {
        "order": detail,
        "summary": summary,
        "step_id": step_id or "",
        "role": role,
        "role_label": ROLES.get(role, role),
        "stage_passport": stage_passport,
        "proposals": proposals,
        "questions": questions,
        "log": log,
        "ai": {
            "used": bool(use_ai),
            "ok": bool(ai.get("ok")),
            "error": str(ai.get("error") or ""),
            "filled": list(ai.get("filled") or []),
            "answer_checks": ai.get("answer_checks") or {},
        },
    }


def _own_service_lists(order: dict, proposals: list, role: str) -> dict:
    """Свои заполненные поля и черновики. Чужие черновики остаются числом."""
    filled: list[dict] = []
    sections = order.get("sections") if isinstance(order.get("sections"), dict) else {}
    for spec in ROLE_FIELDS_SPEC.get(role) or []:
        bucket = sections.get(spec["section"])
        if not isinstance(bucket, dict):
            continue
        value = str(bucket.get(spec["key"]) or "").strip()
        if not value:
            continue
        filled.append({"label": str(spec["label"]), "value": value[:200]})
        if len(filled) >= 12:
            break
    drafts: list[dict] = []
    others = 0
    more_own = 0
    for item in proposals:
        if not isinstance(item, dict):
            continue
        if str(item.get("status") or "draft") != "draft":
            continue
        owner = str(item.get("owner_role") or "")
        if role and owner != role:
            others += 1
            continue
        value = str(item.get("value") or "").strip()
        label = str(item.get("label") or item.get("field") or "поле").strip() or "поле"
        if len(drafts) >= 12:
            more_own += 1
            continue
        drafts.append(
            {
                "id": str(item.get("id") or ""),
                "label": label,
                "value": value[:200],
                "status": "draft",
            }
        )
    return {"filled": filled, "drafts": drafts, "other_drafts": others, "more_own": more_own}


def _employee_brief(
    *,
    order: dict,
    role: str,
    role_label: str,
    passport: dict,
    proposals: list,
    questions: list,
    other_questions: int,
) -> str:
    """Сводка сотруднику: известные факты, чек-лист, свои черновики и один свой вопрос."""
    bits: list[str] = []
    for item in order.get("known") or []:
        text = str(item).strip()
        if not text or text.casefold().startswith("путь 1с"):
            continue
        label, sep, value = text.partition(":")
        value = value.strip().rstrip(".")
        label = label.strip()
        if sep and value:
            bits.append(f"{label[:1].lower()}{label[1:]} {value}")
        else:
            bits.append(text)
        if len(bits) >= 8:
            break
    paragraphs: list[str] = []
    if bits:
        who = f"По службе {role_label} " if role_label else ""
        paragraphs.append(f"{who}уже есть " + ", ".join(bits) + ".")
    label = str(passport.get("label") or "").strip()
    done = passport.get("checks_done")
    total = passport.get("checks_total")
    if label and done is not None and total is not None:
        blocker = str(passport.get("blocker") or "").strip()
        line = f"Этап «{label}»: чек-лист {done} из {total}."
        line += f" {blocker}." if blocker else " Блокировок этапа нет."
        paragraphs.append(line)
    lists = _own_service_lists(order, proposals, role)
    own_lines = [f"{item['label']} — {item['value']}" for item in lists["drafts"] if item.get("value")]
    if own_lines:
        paragraphs.append("Черновики вашей службы:\n" + "\n".join(own_lines))
    if lists["more_own"]:
        paragraphs.append(f"И ещё {lists['more_own']} своих черновиков.")
    if lists["other_drafts"]:
        paragraphs.append(f"Черновиков других служб: {lists['other_drafts']}.")
    elif proposals and not own_lines:
        paragraphs.append(f"К принятию {len(proposals)} черновиков.")
    ask = next(
        (
            str(item.get("prompt") or "").strip()
            for item in questions
            if isinstance(item, dict) and str(item.get("prompt") or "").strip()
        ),
        "",
    )
    if ask:
        if ask[-1] not in ".!?":
            ask += "."
        paragraphs.append(ask)
    elif role and other_questions:
        paragraphs.append("По вашей службе пустых полей нет. Открытые пункты ведут другие службы.")
    return "\n\n".join(paragraphs)


def _facts_text(known: list) -> str:
    lines = [str(item).strip() for item in known if str(item).strip()]
    lines = [item if len(item) <= 400 else item[:400] + "…" for item in lines[:80]]
    text = "; ".join(lines)
    if len(text) > 6000:
        text = text[:6000] + "…"
    return text


def _agent_prepare_payload(res: dict) -> dict:
    """Короткий ответ инструмента: факты 1С остаются в тексте, даже если полный JSON уходит в файл."""
    order = res.get("order") or {}
    known = [str(item).strip() for item in (order.get("known") or []) if str(item).strip()]
    known = [item if len(item) <= 400 else item[:400] + "…" for item in known[:80]]
    facts = _facts_text(known)
    passport = res.get("stage_passport") or {}
    questions = [
        {"id": item.get("id"), "prompt": str(item.get("prompt") or "")[:180]}
        for item in (res.get("questions") or [])[:1]
        if isinstance(item, dict) and str(item.get("prompt") or "").strip()
    ]
    lists = _own_service_lists(order, list(res.get("proposals") or []), str(res.get("role") or ""))
    proposals = lists["drafts"]
    if facts:
        note = (
            "Поле known — путь 1С и опросный лист. Ответь по нему. "
            "Чего нет в known — в 1С этого нет, не выдумывай и не спрашивай то, что уже написано."
        )
    else:
        facts = "пусто: 1С и опросный лист ничего не вернули"
        note = "Поле known пустое: 1С и опросный лист ничего не вернули. Так и напиши, не выдумывай НДС, цену и срок."
    return {
        "ok": True,
        "id": order.get("id"),
        "code": order.get("code"),
        "customer": order.get("customer"),
        "product": order.get("product"),
        "status_label": order.get("status_label"),
        "summary": str(res.get("summary") or ""),
        "role": res.get("role") or "",
        "role_label": res.get("role_label") or "",
        "proposals_count": len(lists["drafts"]) + int(lists["other_drafts"]),
        "role_proposals_count": len(lists["drafts"]),
        "filled": lists["filled"],
        "drafts": lists["drafts"],
        "other_drafts": lists["other_drafts"],
        "known": known,
        "facts": facts,
        "questions": questions,
        "proposals": proposals,
        "stage": {
            "id": passport.get("id"),
            "label": passport.get("label"),
            "checks_done": passport.get("checks_done"),
            "checks_total": passport.get("checks_total"),
            "blocker": str(passport.get("blocker") or "")[:180],
        },
        "note": note + " Черновик принимает сотрудник кнопкой «Принять».",
    }


def invoke_tool(arguments: dict, *, fio: str) -> dict:
    from app.db.session import SessionLocal

    args = arguments or {}
    action = str(args.get("action") or "read").strip()
    order_id = str(args.get("order_id") or "").strip()
    role = str(args.get("role") or "ks").strip()
    if role not in ROLES or role == "viewer":
        role = "ks"
    step_id = str(args.get("step_id") or "").strip()
    db = SessionLocal()
    try:
        if action == "read":
            return read_case(db, order_id, role=role, step_id=step_id)
        if action == "read_full":
            return read_full_case(db, order_id, role=role, step_id=step_id)
        if action == "scenario":
            from app.services.external_order_case import case_scenario

            return case_scenario(_order(db, order_id), str(args.get("scenario") or ""), role=role)
        if action == "auto_prepare":
            res = run_copilot(
                db,
                order_id,
                role=role,
                fio=fio,
                step_id=step_id,
                message=str(args.get("message") or ""),
                answers=args.get("answers") if isinstance(args.get("answers"), dict) else None,
                auto_prepare=True,
            )
            order_data = res["order"]
            return _agent_prepare_payload(res)
        if action == "propose":
            body = propose(
                db,
                order_id,
                fio=fio,
                findings=list(args.get("findings") or []),
                diffs=list(args.get("diffs") or []),
                section_proposals=list(args.get("section_proposals") or []),
                check_proposals=list(args.get("check_proposals") or []),
                baseline_proposal=args.get("baseline_proposal") if isinstance(args.get("baseline_proposal"), dict) else None,
                risk_proposals=list(args.get("risk_proposals") or []),
            )
            drafts = [
                {
                    "id": item.get("id"),
                    "field": item.get("field"),
                    "value": str(item.get("value") or "")[:200],
                    "status": item.get("status"),
                    "kind": item.get("kind") or "",
                }
                for item in (body.get("findings") or [])
                if item.get("status") == "draft"
            ]
            proposed = int(body.get("proposed") or 0)
            skipped = list(body.get("skipped") or [])
            return {
                "ok": proposed > 0 or not skipped,
                "proposed": proposed,
                "unchanged": list(body.get("unchanged") or []),
                "skipped": skipped,
                "drafts": drafts[-12:],
                "note": body.get("note") or "",
            }
        if action == "draft_1c":
            return draft_onec(db, order_id, fio=fio, fields=args)
        if action == "search_1c":
            query = str(args.get("query") or args.get("q") or "").strip()
            counterparty_key = str(args.get("counterparty_key") or args.get("counterparty") or "").strip()
            try:
                return search_onec(query=query, counterparty_key=counterparty_key)
            except ExternalOrderError as exc:
                return {"ok": False, "orders": [], "tkp": [], "note": exc.detail}
        if action in {"plan", "plan_preview"}:
            from app.services.external_order_plan import build_work_plan, preview_work_plan

            overrides = args.get("overrides") if isinstance(args.get("overrides"), dict) else {}
            start = str(args.get("start") or "").strip()
            if action == "plan_preview":
                return _plan_brief(preview_work_plan(db, order_id, overrides=overrides, start=start))
            result = build_work_plan(db, order_id, fio=fio, overrides=overrides, start=start)
            return {**{key: value for key, value in result.items() if key != "model"}, "plan": _plan_brief(result["model"])}
        raise ExternalOrderError("Неизвестное действие")
    except ExternalOrderError as exc:
        raise RuntimeError(exc.detail) from exc
    finally:
        db.close()


def _release_db(db: Session) -> None:
    """Отдать соединение в пул перед долгим чтением 1С или запросом к Cursor.

    commit() закрывает транзакцию и возвращает соединение. close() здесь не нужен:
    он отсоединил бы заказ, с которым запрос продолжает работать.
    """
    db.commit()


def _next_order_code(db: Session) -> str:
    """Следующий номер по максимальному коду, а не по числу строк: удалённые заказы не занимают номер повторно."""
    highest = 0
    taken: set[str] = set()
    for (code,) in db.query(ExternalOrder.code).all():
        text = (code or "").strip()
        taken.add(text)
        match = re.fullmatch(r"ВЗ-(\d+)", text)
        if match:
            highest = max(highest, int(match.group(1)))
    number = highest + 1
    while True:
        candidate = f"ВЗ-{number:04d}"
        if candidate not in taken:
            return candidate
        number += 1


def _order_by_number(db: Session, number: str) -> ExternalOrder | None:
    text = (number or "").strip()
    if not text or text == "без номера":
        return None
    for row in db.query(ExternalOrder).order_by(ExternalOrder.created_at).all():
        if _onec_number(row) == text:
            return row
    return None


def collapse_imported_duplicates(db: Session) -> int:
    """Убирает пустые повторные загрузки одного заказа 1С. Карточку с черновиками не трогает."""
    groups: dict[str, list[ExternalOrder]] = {}
    for row in db.query(ExternalOrder).order_by(ExternalOrder.created_at).all():
        number = _onec_number(row)
        if number:
            groups.setdefault(number, []).append(row)
    removed = 0
    for items in groups.values():
        if len(items) < 2:
            continue
        keeper = max(items, key=lambda item: (len(item.findings), len(item.documents), -item.created_at.timestamp()))
        for row in items:
            if row.id == keeper.id or row.findings or row.documents:
                continue
            db.delete(row)
            removed += 1
    db.flush()
    by_code: dict[str, list[ExternalOrder]] = {}
    for row in db.query(ExternalOrder).order_by(ExternalOrder.created_at).all():
        by_code.setdefault(row.code, []).append(row)
    for items in by_code.values():
        if len(items) < 2:
            continue
        keeper = max(items, key=lambda item: (len(item.findings), len(item.documents), -item.created_at.timestamp()))
        for row in items:
            if row.id == keeper.id:
                continue
            row.code = _next_order_code(db)
            db.flush()
    db.commit()
    return removed


def _order_by_onec(db: Session, ref_key: str) -> ExternalOrder | None:
    key = (ref_key or "").strip()
    if not key:
        return None
    for row in db.query(ExternalOrder).all():
        if _onec_key(row) == key:
            return row
    return None


def recent_onec_orders(
    *,
    skip: int = 0,
    top: int = 50,
    filters: dict[str, str] | None = None,
    refresh: bool = False,
    source: str = "tkp",
) -> dict:
    from app.services.external_order_onec import OnecLinkError, recent_sale_orders_page, recent_tkp_page

    try:
        page = recent_sale_orders_page if source == "orders" else recent_tkp_page
        return page(skip=skip, top=top, filters=filters, refresh=refresh)
    except OnecLinkError as exc:
        raise ExternalOrderError(exc.detail, exc.status) from exc


def _order_by_tkp(db: Session, ref_key: str) -> ExternalOrder | None:
    key = (ref_key or "").strip()
    if not key:
        return None
    for row in db.query(ExternalOrder).all():
        if str(_onec_link(row).get("tkp_key") or "") == key:
            return row
    return None


def import_tkp_order(db: Session, *, role: str, fio: str, ref_key: str) -> dict:
    if role not in _LINK_ROLES:
        raise ExternalOrderError(
            "Путь из 1С загружают коммерческая служба, развитие, финансы или ИТ",
            403,
        )
    key = (ref_key or "").strip()
    if not key:
        raise ExternalOrderError("Нужно коммерческое предложение из 1С", 400)
    found = _order_by_tkp(db, key)
    if found is not None:
        return _detail(found)
    from app.services.external_order_onec import OnecLinkError, trace_tkp

    _release_db(db)
    try:
        traced = trace_tkp(key)
    except OnecLinkError as exc:
        raise ExternalOrderError(exc.detail, exc.status) from exc
    number = traced.get("tkp_number") or "без номера"
    customer = traced.get("counterparty") or "Контрагент из 1С"
    product = traced.get("comment") or f"ТКП {number}"
    created = create_order(
        db,
        role=role,
        fio=fio,
        fields={"customer": customer, "product": product, "inn": traced.get("inn") or ""},
        allow_import=True,
    )
    row = _order(db, created["id"])
    _apply_onec(row, traced)
    _remember_tkp_terms(row, traced=True)
    _audit(
        db,
        row,
        fio=fio,
        role=role,
        action="onec_path",
        detail=_path_label(row) or number,
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def import_onec_order(db: Session, *, role: str, fio: str, ref_key: str) -> dict:
    if role not in _LINK_ROLES:
        raise ExternalOrderError(
            "Заказ из 1С загружают коммерческая служба, развитие, финансы или ИТ",
            403,
        )
    key = (ref_key or "").strip()
    if not key:
        raise ExternalOrderError("Нужен заказ клиента из 1С", 400)
    found = _order_by_onec(db, key)
    if found is not None:
        return _detail(found)
    from app.services.external_order_onec import OnecLinkError, read_order

    _release_db(db)
    try:
        preview = read_order(key)
    except OnecLinkError as exc:
        raise ExternalOrderError(exc.detail, exc.status) from exc
    number = str(preview.get("order_number") or "").strip() or "без номера"
    already = _order_by_number(db, number)
    if already is not None:
        return _detail(already)
    customer = str(preview.get("counterparty") or "").strip() or "Контрагент из 1С"
    product = str(preview.get("product") or preview.get("comment") or "").strip() or f"Заказ клиента {number}"
    created = create_order(
        db,
        role=role,
        fio=fio,
        fields={
            "customer": customer,
            "product": product,
            "inn": str(preview.get("inn") or ""),
        },
        allow_import=True,
    )
    return link_onec(db, created["id"], role=role, fio=fio, ref_key=key)


def search_onec(query: str = "", counterparty_key: str = "") -> dict:
    from app.services.external_order_onec import OnecLinkError, search

    try:
        return search(query, counterparty_key)
    except OnecLinkError as exc:
        raise ExternalOrderError(exc.detail, exc.status) from exc


_TKP_TERM_FIELDS = (
    "vat",
    "currency",
    "delivery_days",
    "payment_form",
    "delivery",
    "valid_until",
    "product",
    "end_customer",
    "order_subject",
)


def _remember_tkp_terms(row: ExternalOrder, *, traced: bool = False) -> None:
    """Добирает условия ТКП только если путь их ещё не принёс. Повторное чтение карточки не запускает."""
    from app.services.external_order_onec import tkp_card

    link = _onec_link(row)
    if any(str(link.get(field) or "").strip() for field in ("vat", "currency", "delivery_days", "payment_form", "product")):
        return
    if traced:
        return
    key = str(link.get("tkp_key") or "").strip()
    if not key:
        return
    try:
        card = tkp_card(key)
    except Exception:  # noqa: BLE001
        return
    if not card:
        return
    sections = _load(row.sections_json)
    onec = dict(sections.get("onec") or {})
    changed = False
    for field in _TKP_TERM_FIELDS:
        value = str(card.get(field) or "").strip()
        if value and not str(onec.get(field) or "").strip():
            onec[field] = value
            changed = True
    if not changed:
        return
    sections["onec"] = onec
    row.sections_json = _dump(sections)


def _apply_onec(row: ExternalOrder, link: dict[str, str]) -> None:
    sections = _load(row.sections_json)
    previous = sections.get("onec") if isinstance(sections.get("onec"), dict) else {}
    flat = {key: str(value or "") for key, value in link.items() if key not in {"suggested_stage", "suggested_status"}}
    for key in (
        "path",
        "tkp_key",
        "tkp_number",
        "tkp_status",
        "tkp_status_label",
        "contract_number",
        *_TKP_TERM_FIELDS,
    ):
        if not flat.get(key) and previous.get(key):
            flat[key] = str(previous.get(key) or "")
    sections["onec"] = flat
    row.sections_json = _dump(sections)
    row.payment_percent = int(link.get("payment_percent") or 0)
    if link.get("counterparty"):
        row.customer = str(link["counterparty"])
    if link.get("inn"):
        row.inn = str(link["inn"])
    stage = str(link.get("suggested_stage") or "")
    status = str(link.get("suggested_status") or "")
    if stage in STAGES:
        row.stage = stage
    if status in STATUSES:
        row.status = status
    _sync_passed_checks(row)


def link_onec(db: Session, order_id: str, *, role: str, fio: str, ref_key: str) -> dict:
    if role not in _LINK_ROLES:
        raise ExternalOrderError(
            "Привязку заказа 1С делает коммерческая служба, развитие, финансы или ИТ",
            403,
        )
    from app.services.external_order_onec import OnecLinkError, read_order, tkp_key_for_order, trace_tkp

    _order(db, order_id)
    _release_db(db)
    try:
        traced = _trace_or_order(ref_key, read_order, tkp_key_for_order, trace_tkp)
    except OnecLinkError as exc:
        raise ExternalOrderError(exc.detail, exc.status) from exc
    row = _order(db, order_id)
    _apply_onec(row, traced)
    _remember_tkp_terms(row, traced=True)
    _audit(
        db,
        row,
        fio=fio,
        role=role,
        action="onec_link",
        detail=_path_label(row) or f"{traced.get('order_number')} · {traced.get('payment_percent')}%",
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def refresh_onec(db: Session, order_id: str, *, role: str, fio: str) -> dict:
    if role == "viewer":
        raise ExternalOrderError("Для этой должности заказ только для чтения", 403)
    from app.services.external_order_onec import OnecLinkError, read_order, tkp_key_for_order, trace_tkp

    row = _order(db, order_id)
    saved = _load(row.sections_json).get("onec")
    saved = saved if isinstance(saved, dict) else {}
    tkp_key = str(saved.get("tkp_key") or "")
    ref_key = str(saved.get("order_key") or "")
    if not tkp_key and not ref_key:
        raise ExternalOrderError("Сначала загрузите ТКП или заказ клиента из 1С", 400)
    _release_db(db)
    try:
        if tkp_key:
            traced = trace_tkp(tkp_key)
        else:
            traced = _trace_or_order(ref_key, read_order, tkp_key_for_order, trace_tkp)
    except OnecLinkError as exc:
        raise ExternalOrderError(exc.detail, exc.status) from exc
    row = _order(db, order_id)
    _apply_onec(row, traced)
    _remember_tkp_terms(row, traced=True)
    _audit(db, row, fio=fio, role=role, action="onec_refresh", detail=_path_label(row) or f"{traced.get('payment_percent')}%")
    db.commit()
    db.refresh(row)
    return _detail(row)


def save_order_text(db: Session, order_id: str, *, role: str, fio: str, fields: dict) -> dict:
    from app.services.external_order_case import store_text_file

    row = _order(db, order_id)
    store_text_file(
        db,
        row,
        role=role,
        fio=fio,
        kind=str(fields.get("kind") or "correspondence"),
        title=str(fields.get("title") or ""),
        text=str(fields.get("text") or ""),
        target=str(fields.get("target") or ""),
        relation=str(fields.get("relation") or "attachment"),
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def upload_order_file(db: Session, order_id: str, *, role: str, fio: str, fields: dict) -> dict:
    from app.services.external_order_case import store_file

    row = _order(db, order_id)
    store_file(
        db,
        row,
        role=role,
        fio=fio,
        kind=str(fields.get("kind") or "other"),
        filename=str(fields.get("filename") or ""),
        content_b64=str(fields.get("content_base64") or ""),
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def approve_order_file(db: Session, order_id: str, document_id: str, *, role: str, fio: str) -> dict:
    from app.services.external_order_case import approve_file

    row = _order(db, order_id)
    approve_file(db, row, document_id, role=role, fio=fio)
    db.commit()
    db.refresh(row)
    return _detail(row)


def link_order_file(
    db: Session, order_id: str, document_id: str, *, role: str, fio: str, fields: dict
) -> dict:
    from app.services.external_order_case import link_documents

    row = _order(db, order_id)
    link_documents(
        db,
        row,
        document_id,
        role=role,
        fio=fio,
        target=str(fields.get("target") or ""),
        relation=str(fields.get("relation") or "attachment"),
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def unlink_order_file(db: Session, order_id: str, link_id: str, *, role: str, fio: str) -> dict:
    from app.services.external_order_case import unlink_document

    row = _order(db, order_id)
    unlink_document(db, row, link_id, role=role, fio=fio)
    db.commit()
    db.refresh(row)
    return _detail(row)


def edit_order_file(
    db: Session, order_id: str, document_id: str, *, role: str, fio: str, fields: dict
) -> dict:
    from app.services.external_order_case import edit_file

    row = _order(db, order_id)
    edit_file(
        db,
        row,
        document_id,
        role=role,
        fio=fio,
        kind=str(fields.get("kind") or ""),
        title=str(fields.get("title") or ""),
    )
    db.commit()
    db.refresh(row)
    return _detail(row)


def delete_order_file(db: Session, order_id: str, document_id: str, *, role: str, fio: str) -> dict:
    from app.services.external_order_case import delete_file

    row = _order(db, order_id)
    delete_file(db, row, document_id, role=role, fio=fio)
    db.commit()
    db.refresh(row)
    return _detail(row)


def add_baseline(db: Session, order_id: str, *, role: str, fio: str, fields: dict) -> dict:
    from app.services.external_order_case import create_baseline

    row = _order(db, order_id)
    create_baseline(db, row, role=role, fio=fio, fields=fields)
    db.commit()
    db.refresh(row)
    return _detail(row)


def make_plan(db: Session, order_id: str, *, role: str, fio: str) -> dict:
    from app.services.external_order_case import build_plan

    row = _order(db, order_id)
    build_plan(db, row, role=role, fio=fio)
    db.commit()
    db.refresh(row)
    return _detail(row)


def accept_plan(db: Session, order_id: str, *, role: str, fio: str) -> dict:
    from app.services.external_order_case import approve_plan

    row = _order(db, order_id)
    approve_plan(db, row, role=role, fio=fio)
    db.commit()
    db.refresh(row)
    return _detail(row)


def publish_order_plan(db: Session, order_id: str, *, role: str, fio: str) -> dict:
    from app.services.external_order_case import publish_plan

    row = _order(db, order_id)
    publish_plan(db, row, role=role, fio=fio)
    db.commit()
    db.refresh(row)
    return _detail(row)


def _trace_or_order(ref_key: str, read_order, tkp_key_for_order, trace_tkp) -> dict:
    tkp_key = tkp_key_for_order(ref_key)
    if tkp_key:
        return trace_tkp(tkp_key)
    return read_order(ref_key)


def _plan_brief(model: dict) -> dict:
    """План для агента: короткие строки задач, предупреждения и вопросы РП только по ним."""
    tasks = [
        {
            "key": item["key"],
            "wbs": item["wbs"],
            "name": item["name"],
            "days": item["duration_days"],
            "start": item["start"][:10],
            "finish": item["finish"][:10],
            "service": item["resource_name"],
            "source": item["source"],
            "milestone": item["milestone"],
        }
        for item in model["tasks"]
        if item["group"] == "work"
    ]
    questions = []
    for item in model["warnings"]:
        if item["code"] == "norm_duration":
            questions.append(f"Сколько рабочих дней занимает «{item['text'].split('»')[0].lstrip('«')}»? В деле срока нет.")
        elif item["code"] == "condition_missing":
            questions.append(f"{item['text']}. Где это условие в договоре или кто его даст?")
        elif item["code"] == "no_resource":
            questions.append(f"Какая служба выполняет {item['text'].replace(' без службы', '')}?")
        elif item["code"] == "over_term":
            questions.append(f"{item['text']}. Какие сроки сократить?")
    return {
        "ok": True,
        "summary": model["summary"],
        "start": model["start"],
        "finish": model["finish"],
        "contract_number": model["contract_number"],
        "outline_source": model["outline_source"],
        "tasks": tasks,
        "missing_conditions": [item["label"] for item in model["conditions"] if item["missing"]],
        "warnings": model["warnings"],
        "questions": questions[:12],
        "agent_limits": "Даты, цены, НДС и сроки не выдумывай: чего нет — «в деле нет». Стадию не переводи. Черновик фактом не является.",
    }


def _case_summary(body: dict) -> str:
    """Короткий ответ агенту. Полная карточка может уйти в result_file — его агент дочитывает Read."""
    status = str(body.get("status") or "")
    nxt = NEXT_GATE.get(status, "")
    who = ", ".join(ROLES[role] for role in ROLES if role in TRANSITION_ROLES.get(nxt, set())) or "не назначено"
    nxt_label = STATUSES.get(nxt, nxt) if nxt else "нет"
    path = str(body.get("path_label") or "в 1С не разложен")
    if len(path) > 1500:
        path = path[:1500] + "…"
    known = [str(item).strip() for item in (body.get("known") or []) if str(item).strip()]
    known_text = ""
    if known:
        shown = "; ".join(known)
        if len(shown) > 3000:
            shown = shown[:3000] + "…"
        known_text = f" Уже известно, не спрашивать: {shown}."
    return (
        f"Заказ {body.get('code')} ({body.get('customer')}, {body.get('product')}). "
        f"Стадия «{body.get('status_label')}». {body.get('payment_note')}. "
        f"Путь: {path}. "
        f"Следующий переход «{nxt_label}» делает: {who}. "
        f"{body.get('project_note')}.{known_text} Черновик фактом не является."
    )


_GATE_ORDER = (
    "before_calc",
    "before_committee",
    "before_tkp",
    "before_sign",
    "before_project",
    "before_production",
    "before_psi",
    "before_ship",
    "before_close",
)
_GATE_LABEL = {
    "before_calc": "до расчёта",
    "before_committee": "до Комитета",
    "before_tkp": "до ТКП",
    "before_sign": "до подписания",
    "before_project": "до проекта",
    "before_production": "до запуска",
    "before_psi": "до ПСИ",
    "before_ship": "до отгрузки",
    "before_close": "до закрытия",
}


def _open_by_service(body: dict) -> dict[str, str]:
    grouped: dict[str, list[tuple[int, str]]] = {}
    for item in body.get("checks") or []:
        if not isinstance(item, dict) or item.get("status") in {"done", "not_applicable"}:
            continue
        gate = str(item.get("gate") or "")
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        order = _GATE_ORDER.index(gate) if gate in _GATE_ORDER else len(_GATE_ORDER)
        grouped.setdefault(str(item.get("owner_role") or ""), []).append(
            (order, f"{_GATE_LABEL.get(gate, gate)}: {text}")
        )
    lines: dict[str, str] = {}
    for role, texts in grouped.items():
        line = "; ".join(text for _order, text in sorted(texts))
        if len(line) > 220:
            line = line[:220] + "…"
        lines[ROLES.get(role, role)] = line
    return lines


def read_case(db: Session, order_id: str, *, role: str = "", step_id: str = "") -> dict:
    body = get_order(db, order_id)
    passports = body.get("stage_passports") or []
    current_passport = (
        next((p for p in passports if body.get("status") in p.get("statuses", [])), None)
        or (passports[0] if passports else {})
    )
    role_key = role if role in ROLES and role != "viewer" else "ks"
    role_qs = (body.get("role_questions") or {}).get(role_key, [])[:6]
    drafts = [
        item
        for item in (body.get("findings") or [])
        if isinstance(item, dict) and item.get("status") == "draft"
    ]
    lists = _own_service_lists(body, drafts, role_key)
    return {
        "id": body.get("id"),
        "code": body.get("code"),
        "customer": body.get("customer"),
        "product": body.get("product"),
        "status": body.get("status"),
        "status_label": body.get("status_label"),
        "stage": body.get("stage"),
        "stage_label": body.get("stage_label"),
        "route": body.get("route"),
        "route_label": body.get("route_label"),
        "payment_note": body.get("payment_note"),
        "path_label": body.get("path_label"),
        "project_note": body.get("project_note"),
        "known": body.get("known") or [],
        "facts": _facts_text(body.get("known") or []),
        "blocks": body.get("blocks") or [],
        "owners": body.get("owners") or {},
        "sections": body.get("sections") or {},
        "stage_passport": {
            "id": current_passport.get("id"),
            "label": current_passport.get("label"),
            "state": current_passport.get("state"),
            "checks_done": current_passport.get("checks_done"),
            "checks_total": current_passport.get("checks_total"),
            "blocker": current_passport.get("blocker"),
        },
        "draft_findings": lists["drafts"],
        "filled": lists["filled"],
        "drafts": lists["drafts"],
        "other_drafts": lists["other_drafts"],
        "questions": [
            {"id": q.get("id"), "prompt": q.get("prompt"), "owner_role": q.get("owner_role")}
            for q in role_qs
        ],
        "open_by_service": {
            ROLES.get(role_key, role_key): _open_by_service(body).get(ROLES.get(role_key, role_key), "")
        },
        "summary": _case_summary(body),
        "agent_limits": (
            "Ответь по summary, known и своей строке в open_by_service. result_file не открывай. "
            "known — путь 1С и опросный лист. По этим фактам вопрос не задавай. "
            "Не утверждай цену, договор, бюджет, риск и стадию. "
            "Не придумывай документы, которых нет в пути. Черновик фактом не является."
        ),
    }


def read_full_case(db: Session, order_id: str, *, role: str = "", step_id: str = "") -> dict:
    from app.services.external_order_case import document_excerpt_shells, fill_document_excerpt_files

    row = _order(db, order_id)
    body = _detail(row)
    shells = document_excerpt_shells(row)
    # Разбор файлов не должен держать соединение: иначе список заказов ждёт пул.
    _release_db(db)
    excerpts = fill_document_excerpt_files(shells)
    passports = body.get("stage_passports") or []
    current_passport = (
        next((p for p in passports if body.get("status") in p.get("statuses", [])), None)
        or (passports[0] if passports else {})
    )
    role_key = role if role in ROLES and role != "viewer" else "ks"
    role_qs = (body.get("role_questions") or {}).get(role_key, [])
    service_lists = _own_service_lists(body, body.get("findings") or [], role_key)
    open_diffs = [
        item
        for item in (body.get("diffs") or [])
        if item.get("status") != "closed"
    ]
    return {
        "id": body.get("id"),
        "code": body.get("code"),
        "customer": body.get("customer"),
        "inn": body.get("inn"),
        "product": body.get("product"),
        "order_type": body.get("order_type"),
        "priority": body.get("priority"),
        "stage": body.get("stage"),
        "stage_label": body.get("stage_label"),
        "status": body.get("status"),
        "status_label": body.get("status_label"),
        "route": body.get("route"),
        "route_label": body.get("route_label"),
        "payment_percent": body.get("payment_percent"),
        "payment_note": body.get("payment_note"),
        "path_label": body.get("path_label"),
        "known": body.get("known") or [],
        "facts": _facts_text(body.get("known") or []),
        "blocks": body.get("blocks") or [],
        "owners": body.get("owners") or {},
        "sections": body.get("sections") or {},
        "stage_passport": current_passport,
        "stage_passports": passports,
        "documents": body.get("documents") or [],
        "document_links": body.get("document_links") or [],
        "document_excerpts": excerpts,
        "findings": body.get("findings") or [],
        "lines": body.get("lines") or [],
        "diffs": open_diffs,
        "gaps": [g for g in (body.get("gaps") or []) if g.get("status") == "open"],
        "baselines": body.get("baselines") or [],
        "risks": body.get("risks") or [],
        "decisions": body.get("decisions") or [],
        "questions": role_qs,
        "role_questions": body.get("role_questions") or {},
        "open_by_service": _open_by_service(body),
        "summary": _case_summary(body),
        "filled": service_lists["filled"],
        "drafts": service_lists["drafts"],
        "other_drafts": service_lists["other_drafts"],
        "note": "Полная структурированная выжимка дела. Черновик фактом не является.",
    }

