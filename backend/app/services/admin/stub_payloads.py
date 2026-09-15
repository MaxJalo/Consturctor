"""Static admin tab payloads aligned with desktop `adminMocks.ts` (stub API)."""

from __future__ import annotations

from copy import deepcopy

from app.services.admin.common import empty_launch_dynamics

_PERIOD = {"periodLabel": "Период: Неделя", "dateRange": "08.09.2026 — 14.09.2026"}

_HISTORY = {
    **_PERIOD,
    "breadcrumb": "История — Процессы, задачи, письма, задачи по проектам",
    "title": "История",
    "subtitle": "Просмотр выполненных процессов, задач, писем и проектных задач",
    "tabs": [
        {"id": "processes", "label": "Процессы"},
        {"id": "tasks", "label": "Задачи"},
        {"id": "letters", "label": "Письма"},
        {"id": "project_tasks", "label": "Задачи по проектам"},
    ],
    "activeTab": "processes",
    "filters": [
        {"id": "status", "options": ["Все статусы", "Завершен", "В работе", "Ошибка", "Отменен"]},
        {"id": "agent", "options": ["Все агенты", "Агент_Совещания", "Агент_Аналитика"]},
        {"id": "process", "options": ["Все процессы", "Подготовка совещания", "Анализ рынка"]},
        {"id": "user", "options": ["Все пользователи", "Иванов И.И.", "Петров А.А."]},
    ],
    "rows": [
        {
            "id": "P-458",
            "process": "Подготовка совещания",
            "agent": "Агент_Совещания",
            "user": "Петров А.А.",
            "status": "Завершен",
            "statusTone": "success",
            "launchedAt": "14.09.2026 10:15",
            "duration": "12 мин",
            "sla": "ok",
        }
    ],
    "pagination": {"pageSize": 10, "total": 248},
}

_USERS = {
    "breadcrumb": "Пользователи — Управление доступом и активностью",
    "title": "Пользователи",
    "subtitle": "Управление учетными записями, ролями и использованием ИИ-агентов",
    "addLabel": "Добавить пользователя",
    "filters": [
        {"id": "department", "options": ["Все подразделения", "IT", "Продажи"]},
        {"id": "role", "options": ["Все роли", "Администратор", "Пользователь"]},
        {"id": "status", "options": ["Все статусы", "Активен", "Заблокирован"]},
    ],
    "rows": [
        {
            "fio": "Иванов И.И.",
            "position": "Системный администратор",
            "department": "IT",
            "role": "Администратор",
            "status": "Активен",
            "agentsAccess": 37,
            "agentsUsed": 12,
            "lastActivity": "14.09.2026 12:45",
        }
    ],
    "pagination": {"pageSize": 5, "total": 142},
}

_AI_AGENTS = {
    "breadcrumb": "ИИ-агенты — Создание, настройка, версии и мониторинг",
    "title": "ИИ-агенты",
    "subtitle": "Создание, настройка, версии и мониторинг всех ИИ-агентов",
    "createLabel": "Создать агента",
    "importLabel": "Импорт",
    "filters": [
        {"id": "status", "options": ["Все статусы", "Активен", "На настройке"]},
        {"id": "process", "options": ["Все процессы", "Подготовка совещания"]},
        {"id": "owner", "options": ["Все владельцы", "Иванов И.И."]},
    ],
    "rows": [
        {
            "name": "Агент_Совещания",
            "process": "Подготовка совещания",
            "owner": "Иванов И.И.",
            "version": "1.3.2",
            "status": "Активен",
            "statusTone": "success",
            "runs": 1245,
            "successRate": "94%",
            "used": True,
        }
    ],
    "pagination": {"pageSize": 5, "total": 37},
    "detail": {
        "name": "Агент_Совещания",
        "status": "Активен",
        "statusTone": "success",
        "description": "Автоматизирует подготовку материалов и рассылку приглашений.",
        "tabs": ["Обзор", "Текущие процессы", "История запусков"],
        "activeTab": "Обзор",
        "info": [{"label": "Владелец", "value": "Иванов И.И."}],
        "metrics": [{"label": "Всего запусков", "value": "1 245"}],
        "processes": [
            {
                "title": "Подготовка материалов",
                "time": "Запущено 14.09.2026 10:15",
                "status": "Выполняется",
                "statusTone": "success",
                "tone": "green",
            }
        ],
    },
}

_KNOWLEDGE = {
    "breadcrumb": "База знаний — Управление источниками знаний",
    "title": "База знаний",
    "subtitle": "Документы, справочники и источники знаний для ИИ-агентов",
    "addLabel": "Добавить документ",
    "filters": [
        {"id": "type", "options": ["Все типы", "Регламент", "Шаблон"]},
        {"id": "agent", "options": ["Все агенты", "Агент_Закупки"]},
        {"id": "status", "options": ["Все статусы", "Актуален"]},
    ],
    "rows": [
        {
            "name": "Регламент по закупкам",
            "type": "Регламент",
            "agents": "Агент_Закупки",
            "version": "2.1",
            "status": "Актуален",
            "statusTone": "success",
            "updatedAt": "12.09.2026",
        }
    ],
    "pagination": {"pageSize": 5, "total": 257},
    "document": {
        "title": "Регламент по закупкам",
        "status": "Актуален",
        "statusTone": "success",
        "meta": "Регламент • v2.1 • Обновлен 12.09.2026",
        "text": "Документ описывает порядок закупок компании.",
        "format": "PDF (1.4 MB)",
        "author": "Иванов И.И.",
        "category": "Закупки",
        "tags": ["закупки", "регламент"],
        "usageTotal": "428",
        "usageTrend": "+12%",
        "usageBars": [12, 18, 15, 22],
        "agentsShare": [{"label": "Агент_Закупки", "value": 65}],
        "related": [{"title": "Шаблоны КП", "type": "Шаблон"}],
        "relatedCount": 12,
    },
}

_LAUNCH_CALENDAR = {
    **_PERIOD,
    "breadcrumb": "Календарь запуска — Планирование и контроль выполнения",
    "title": "Календарь запусков",
    "subtitle": "Планирование, автозапуски и контроль выполнения агентов",
    "createLabel": "Создать запуск",
    "viewModes": ["День", "Неделя", "Месяц", "Сегодня"],
    "activeView": "Неделя",
    "weekRange": "08.09.2025 — 14.09.2025",
    "days": ["Пн 08.09", "Вт 09.09", "Ср 10.09"],
    "hours": ["08:00", "09:00", "10:00"],
    "events": [
        {
            "id": "e1",
            "dayIndex": 0,
            "startHour": 9,
            "endHour": 10,
            "title": "Подготовка совещаний",
            "tone": "green",
            "agentId": "meet",
        }
    ],
    "agentFilters": [{"id": "all", "label": "Все агенты", "color": "#1a73e8", "checked": True}],
    "miniMonth": "Сентябрь 2025",
    "miniDays": [{"day": 8}, {"day": 9, "active": True}],
    "unscheduled": [
        {
            "id": "u1",
            "title": "Анализ отзывов клиентов",
            "subtitle": "Агент. Аналитика",
            "tone": "purple",
        }
    ],
    "scheduleAllLabel": "Запланировать все",
}

_KPI = {
    "periodLabel": "Период: Месяц",
    "dateRange": "01.09.2026 — 14.09.2026",
    "breadcrumb": "KPI — Анализ эффективности и загрузки системы",
    "title": "KPI",
    "subtitle": "Анализ эффективности и загрузки системы",
    "tabs": [
        {"id": "general", "label": "Общее"},
        {"id": "agents", "label": "Агенты"},
    ],
    "activeTab": "general",
    "summaries": [
        {"id": "s1", "label": "Успешность задач", "value": "92%", "trend": "(+3%)", "trendTone": "positive"}
    ],
    "agentCards": [
        {
            "id": "meet",
            "name": "Агент_Совещания",
            "process": "Подготовка совещания",
            "status": "Активен",
            "statusTone": "success",
            "efficiency": 96,
            "summaries": [{"id": "s1", "label": "Успешность задач", "value": "96%"}],
        }
    ],
    "dynamics": empty_launch_dynamics().model_dump(by_alias=True),
    "topAgents": [{"label": "Агент_Совещания", "value": 96}],
    "gauges": [{"id": "cpu", "label": "CPU", "value": "32%", "tone": "green"}],
}

_SETTINGS = {
    "breadcrumb": "Настройки — Параметры интерфейса",
    "title": "Настройки",
    "subtitle": "Персонализация интерфейса администратора",
}


def stub_history() -> dict:
    return deepcopy(_HISTORY)


def stub_users() -> dict:
    return deepcopy(_USERS)


def stub_ai_agents() -> dict:
    return deepcopy(_AI_AGENTS)


def stub_knowledge_base() -> dict:
    return deepcopy(_KNOWLEDGE)


def stub_launch_calendar() -> dict:
    return deepcopy(_LAUNCH_CALENDAR)


def stub_kpi() -> dict:
    return deepcopy(_KPI)


def stub_settings() -> dict:
    return deepcopy(_SETTINGS)
