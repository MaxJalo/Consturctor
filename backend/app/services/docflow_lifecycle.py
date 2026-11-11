"""Граф статусов документооборота по концепции от 7 октября 2026 года.

Справочник — источник для таблиц docflow_classes, docflow_statuses и docflow_edges.
Развилка — это две стрелки из одного статуса, а не два шага подряд.
Информационный документ не имеет статуса исполнения. У поручения закрытие
доступно только автору. Молчание само по себе переход не делает.
"""

from __future__ import annotations

from dataclasses import dataclass


class TransitionDenied(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class StatusDef:
    code: str
    label: str
    sort: int
    optional: bool = False


@dataclass(frozen=True)
class EdgeDef:
    src: str
    dst: str
    branch: str = ""
    reason_required: bool = False
    author_only: bool = False


@dataclass(frozen=True)
class ClassDef:
    code: str
    title: str
    pilot: bool
    execution: bool
    initial: tuple[str, ...]
    statuses: tuple[StatusDef, ...]
    edges: tuple[EdgeDef, ...]


def _s(code: str, label: str, sort: int, optional: bool = False) -> StatusDef:
    return StatusDef(code, label, sort, optional)


def _e(
    src: str,
    dst: str,
    branch: str = "",
    *,
    reason: bool = False,
    author: bool = False,
) -> EdgeDef:
    return EdgeDef(src, dst, branch, reason, author)


CLASSES: tuple[ClassDef, ...] = (
    ClassDef(
        "incoming",
        "Входящий",
        True,
        True,
        ("received",),
        (
            _s("received", "Получен", 1),
            _s("registered", "Зарегистрирован", 2),
            _s("resolution", "На резолюции", 3),
            _s("executing", "На исполнении", 4),
            _s("for_info", "К сведению", 5),
            _s("done", "Исполнен", 6),
            _s("filed", "В деле", 7),
            _s("archive", "В архиве", 8),
        ),
        (
            _e("received", "registered"),
            _e("registered", "resolution"),
            _e("resolution", "executing", "исполнение"),
            _e("resolution", "for_info", "сведение"),
            _e("executing", "done"),
            _e("for_info", "done"),
            _e("done", "filed"),
            _e("filed", "archive"),
        ),
    ),
    ClassDef(
        "outgoing",
        "Исходящий",
        True,
        True,
        ("draft",),
        (
            _s("draft", "Проект", 1),
            _s("review", "На согласовании", 2),
            _s("signing", "На подписании", 3),
            _s("signed", "Подписан", 4),
            _s("registered", "Зарегистрирован", 5),
            _s("sent", "Отправлен", 6),
            _s("receipt", "Получение подтверждено", 7),
            _s("filed", "В деле", 8),
        ),
        (
            _e("draft", "review"),
            _e("review", "signing"),
            _e("signing", "signed"),
            _e("signed", "registered"),
            _e("registered", "sent"),
            _e("sent", "receipt"),
            _e("receipt", "filed"),
        ),
    ),
    ClassDef(
        "order",
        "Приказ и распоряжение",
        True,
        True,
        ("draft",),
        (
            _s("draft", "Проект", 1),
            _s("review", "На согласовании", 2),
            _s("signing", "На подписании", 3),
            _s("signed_registered", "Подписан и зарегистрирован", 4),
            _s("acquaint", "Ознакомление", 5),
            _s("executing", "На исполнении", 6),
            _s("done", "Исполнен", 7),
            _s("voided", "Утратил силу", 8),
            _s("filed", "В деле", 9),
        ),
        (
            _e("draft", "review"),
            _e("review", "signing"),
            _e("signing", "signed_registered"),
            _e("signed_registered", "acquaint"),
            _e("acquaint", "executing"),
            _e("executing", "done", "исполнен"),
            _e("executing", "voided", "утратил силу", reason=True),
            _e("done", "filed"),
            _e("voided", "filed"),
        ),
    ),
    ClassDef(
        "lna",
        "ЛНА",
        False,
        True,
        ("draft",),
        (
            _s("draft", "Проект", 1),
            _s("review", "На согласовании", 2),
            _s("union_opinion", "Мнение профсоюза", 3, True),
            _s("approval", "Утверждение приказом", 4),
            _s("acquaint", "Ознакомление", 5),
            _s("active", "Действует", 6),
            _s("review_due", "Пересмотр", 7),
            _s("replaced", "Заменён", 8),
            _s("cancelled", "Отменён", 9),
        ),
        (
            _e("draft", "review"),
            _e("review", "union_opinion", "мнение"),
            _e("review", "approval", "без мнения"),
            _e("union_opinion", "approval"),
            _e("approval", "acquaint"),
            _e("acquaint", "active"),
            _e("active", "review_due"),
            _e("review_due", "replaced", "замена"),
            _e("review_due", "cancelled", "отмена", reason=True),
        ),
    ),
    ClassDef(
        "memo",
        "Служебная записка",
        True,
        True,
        ("draft",),
        (
            _s("draft", "Проект", 1),
            _s("review", "На согласовании", 2, True),
            _s("at_addressee", "У адресата", 3),
            _s("assignment", "Поручение", 4),
            _s("refusal", "Отказ с причиной", 5),
            _s("for_info", "К сведению", 6),
            _s("filed", "В деле", 7),
        ),
        (
            _e("draft", "review", "согласование"),
            _e("draft", "at_addressee", "без согласования"),
            _e("review", "at_addressee"),
            _e("at_addressee", "assignment", "поручение"),
            _e("at_addressee", "refusal", "отказ", reason=True),
            _e("at_addressee", "for_info", "сведение"),
            _e("assignment", "filed"),
            _e("refusal", "filed"),
            _e("for_info", "filed"),
        ),
    ),
    ClassDef(
        "contract",
        "Договор",
        False,
        True,
        ("draft",),
        (
            _s("draft", "Проект", 1),
            _s("prereg_1c", "Предварительно в 1С", 2),
            _s("review", "На согласовании", 3),
            _s("signing", "На подписании", 4),
            _s("signed_us", "Подписан нами", 5),
            _s("signed_them", "Подписан контрагентом", 6),
            _s("active", "Действует", 7),
            _s("fulfilled", "Исполнен", 8),
            _s("terminated", "Расторгнут", 9),
            _s("filed", "В деле", 10),
        ),
        (
            _e("draft", "prereg_1c"),
            _e("prereg_1c", "review"),
            _e("review", "signing"),
            _e("signing", "signed_us"),
            _e("signed_us", "signed_them"),
            _e("signed_them", "active"),
            _e("active", "fulfilled", "исполнен"),
            _e("active", "terminated", "расторгнут", reason=True),
            _e("fulfilled", "filed"),
            _e("terminated", "filed"),
        ),
    ),
    ClassDef(
        "hr",
        "Кадровый",
        False,
        True,
        ("draft",),
        (
            _s("draft", "Проект", 1),
            _s("hr_check", "Проверка кадров", 2),
            _s("signing", "На подписании", 3),
            _s("signed_registered", "Подписан и зарегистрирован", 4),
            _s("worker_ack", "Ознакомление работника", 5),
            _s("filed", "В личном деле", 6),
        ),
        (
            _e("draft", "hr_check"),
            _e("hr_check", "signing"),
            _e("signing", "signed_registered"),
            _e("signed_registered", "worker_ack"),
            _e("worker_ack", "filed"),
        ),
    ),
    ClassDef(
        "accounting",
        "Первичный учётный",
        False,
        False,
        ("received", "formed"),
        (
            _s("received", "Получен", 1),
            _s("formed", "Сформирован", 2),
            _s("checked", "Проверен", 3),
            _s("posted_1c", "Проведён в 1С", 4),
            _s("filed", "В деле", 5),
        ),
        (
            _e("received", "checked", "получен"),
            _e("formed", "checked", "сформирован"),
            _e("checked", "posted_1c"),
            _e("posted_1c", "filed"),
        ),
    ),
    ClassDef(
        "project",
        "Проектный",
        False,
        True,
        ("draft",),
        (
            _s("draft", "Проект", 1),
            _s("role_check", "Проверка роли", 2),
            _s("approved", "Утверждён", 3),
            _s("linked_tp", "Связан с TurboProject", 4),
            _s("accepted", "Результат принят", 5),
            _s("filed", "В деле проекта", 6),
        ),
        (
            _e("draft", "role_check"),
            _e("role_check", "approved"),
            _e("approved", "linked_tp"),
            _e("linked_tp", "accepted"),
            _e("accepted", "filed"),
        ),
    ),
    ClassDef(
        "engineering",
        "Конструкторский",
        False,
        True,
        ("developed",),
        (
            _s("developed", "Разработан", 1),
            _s("norm_control", "Нормоконтроль", 2),
            _s("tech_review", "Технические согласования", 3),
            _s("military", "Военная приёмка", 4, True),
            _s("approved", "Утверждён", 5),
            _s("released", "Выпущен с литерой", 6),
            _s("changed", "Изменён извещением", 7),
            _s("annulled", "Аннулирован", 8),
        ),
        (
            _e("developed", "norm_control"),
            _e("norm_control", "tech_review"),
            _e("tech_review", "military", "приёмка"),
            _e("tech_review", "approved", "без приёмки"),
            _e("military", "approved"),
            _e("approved", "released"),
            _e("released", "changed"),
            _e("changed", "annulled", reason=True),
        ),
    ),
    ClassDef(
        "info",
        "Информационный",
        False,
        False,
        ("received", "created"),
        (
            _s("received", "Получен", 1),
            _s("created", "Создан", 2),
            _s("delivered", "Доставлен", 3),
            _s("filed", "В деле", 4),
        ),
        (
            _e("received", "delivered", "получен"),
            _e("created", "delivered", "создан"),
            _e("delivered", "filed"),
        ),
    ),
    ClassDef(
        "assignment",
        "Поручение",
        True,
        True,
        ("registered",),
        (
            _s("registered", "Зарегистрировано", 1),
            _s("accepted", "Принято исполнителем", 2),
            _s("executing", "В работе", 3),
            _s("presented", "Результат сдан", 4),
            _s("closed", "Закрыто автором", 5),
        ),
        (
            _e("registered", "accepted"),
            _e("accepted", "executing"),
            _e("executing", "presented"),
            _e("presented", "closed", author=True),
            _e("presented", "executing", "доработка", reason=True, author=True),
            _e("accepted", "registered", "отказ", reason=True),
            _e("executing", "registered", "отказ", reason=True),
        ),
    ),
)


_BY_CODE = {item.code: item for item in CLASSES}


def class_by_code(code: str) -> ClassDef:
    try:
        return _BY_CODE[code]
    except KeyError as exc:
        raise TransitionDenied("Такого вида документа нет") from exc


def status_by_code(kind: ClassDef, code: str) -> StatusDef:
    for item in kind.statuses:
        if item.code == code:
            return item
    raise TransitionDenied("Такого статуса у этого вида нет")


def edge_between(kind: ClassDef, src: str, dst: str) -> EdgeDef | None:
    for item in kind.edges:
        if item.src == src and item.dst == dst:
            return item
    return None


def assert_transition(
    class_code: str,
    from_code: str,
    to_code: str,
    *,
    actor_is_author: bool,
    reason: str,
) -> EdgeDef:
    """Разрешить переход только по стрелке графа. Сам по времени статус не двигается."""
    kind = class_by_code(class_code)
    status_by_code(kind, from_code)
    status_by_code(kind, to_code)
    edge = edge_between(kind, from_code, to_code)
    if edge is None:
        raise TransitionDenied("Такого перехода в жизненном цикле нет")
    if edge.author_only and not actor_is_author:
        raise TransitionDenied("Этот переход делает только автор")
    if edge.reason_required and not reason.strip():
        raise TransitionDenied("Для этого перехода нужна причина")
    return edge


def lifecycle_public() -> list[dict]:
    items: list[dict] = []
    for kind in CLASSES:
        items.append(
            {
                "code": kind.code,
                "title": kind.title,
                "pilot": kind.pilot,
                "execution": kind.execution,
                "initial": list(kind.initial),
                "statuses": [
                    {
                        "code": status.code,
                        "label": status.label,
                        "sort": status.sort,
                        "optional": status.optional,
                    }
                    for status in kind.statuses
                ],
                "edges": [
                    {
                        "from": edge.src,
                        "to": edge.dst,
                        "branch": edge.branch,
                        "reason_required": edge.reason_required,
                        "author_only": edge.author_only,
                    }
                    for edge in kind.edges
                ],
            }
        )
    return items
