# Источники данных для UI сетки 9×9

По умолчанию v1: **mock** там, где нет API; пометка в UI через `data-origin="mock"` (dev) — TBD.

| Элемент | Статус v1 | Источник |
|---------|-----------|----------|
| Метрики «Процессы» | live | `useSpecV04Sources`, `buildProcessTiles` |
| Таблица процессов | live | agents + 1C + Turbo + Outlook mail + Outlook meetings |
| Задачи 1С | live | `onec.erp_tasks_current` + `onec.docflow_tasks`; при ошибке OData ДО — fallback `onec.search_tasks` (COM, sidecar) |
| Проекты | live | `turboproject.get_user_portfolio` |
| Письма (вкладка «Почта» / процессы) | live | `outlook.search_mail` (COM): `folder=All`, `date_from`/`date_to` = текущая неделя (пн…вс), `max_results=50`; sidecar `agent:search-mail` |
| Письма («Сегодня» → Outlook) | live | `outlook.search_mail`: `folder=Inbox`, `date=YYYY-MM-DD` (день = «Период») |
| Совещания | live/partial | `ensureOutlookMeetings` |
| База знаний | partial | `api.listWorkflows()` (регламенты Constructor) |
| KPI «Сегодня» (5 плиток) | live/partial | `useTodayKpiData` → `useSpecV04Sources` (см. ниже) |
| Сегодня → «Результаты дня» | live | `useTodayAgentResults` → `GET /api/v1/workflows/files` (`listPlatformFiles`), фильтр: `source=agent`, день = «Период», скачивание `api.download` |
| Сегодня → «Подготовленные решения» | live | `useTodayPreparedDecisions` (день = «Период», scope = пользователь): доска `useWorkplaceData` + `useRuns` (live HITL / `WAITING_HUMAN`) + `extractToolDecisions` по прогонам за день (`listAgentRuns` / `getAgentRunDetail`) + файлы агентов без вердикта (`listPlatformFiles`, как «Результаты дня»); подзаголовок — `intent`/`result` инструмента, `summary`/`agentTitle` файла или итог прогона (`run.summary` / `cleanRunResult`); пустой список без demo; mock `TODAY_PREPARED_DECISIONS` не используется |
| Сегодня → «Проектные задачи» | live | `useTodayProjectTasks`: портфель `get_user_portfolio` + до 3× `get_project_tasks` (open); без сеанса Turbo → «Нет активного сеанса» |
| Сегодня → «Задачи из 1С» | live | `useSpecV04Sources`: erp_pm + docflow OData; частичный успех (erp_pm/COM при ошибке ДО); подсказка в hint, не блокирует таблицу |
| Сегодня → «Предстоящие события» | live | `useSpecV04Sources` → `ensureOutlookMeetings`, фильтр по «Период» |
| Сегодня / план дня | live | `useTodayPlanTimeline`: Outlook + доска агентов (без demo-fallback блоков) |
| Глобальный поиск (row 1) | noop | локальный фильтр — TBD endpoint |
| Помощь (?) | link | `https://wiki.turbo-don.ru` (заменить URL по решению) |
| Уведомления | live | `api.listNotifications`, `unread` |
| KPI tiles row 2 (другие вкладки) | mock | до подключения агрегатов KpiPage |

### KPI вкладки «Сегодня» (`buildTodayKpiTiles`)

| Плитка | Источник | Примечание |
|--------|----------|------------|
| Выполнение дня | erp_tasks + агенты доски | % в кольце; value = «N из M»; без Turbo-задач |
| Задачи 1С | `onec.erp_tasks_current` + `onec.docflow_tasks` | erp_pm SQL; ДО OData; при сбое ДО — `onec.search_tasks` (COM, `agent:invoke-ac-tool`) |
| Регламентные работы | `useWorkplaceData` agents (!standalone) | count + выполненные по статусу процесса |
| Проекты | `turboproject.get_user_portfolio` | count портфеля |
| События дня | `ensureOutlookMeetings` + `meetingCountToday` | только встречи на текущий день |
| History journal count | mock | audit API — TBD |
| Decisions comparison table | mock | payload агента — TBD |
| Project calendar (bottom) | mock | TurboProject events tool — TBD |

### Обновление данных (`useGridDataRefresh`)

| Область | Mount / смена user | Focus / visibility | Interval | События |
|---------|-------------------|--------------------|----------|---------|
| `useSpecV04Sources` (KPI, 1С, Turbo портфель, Outlook mail, календарь недели) | да | да | — | — |
| `useWorkplaceData` (доска агентов) | да (`userId`) | да | — | `onBoardUpdated` |
| `useTodayOutlookMail` | да (`periodDay`) | да | — | — |
| `useTodayAgentResults` | да | да | 60 с | `files_updated` (agent SSE) |
| `useTodayPreparedDecisions` | да (`periodDay`, user) | да | 60 с | `files_updated`, `useRuns` / доска |
| `useTodayProjectTasks` | да (портфель + `periodDay`) | да | — | — |
| `useTodayPlanTimeline` (встречи дня) | да | да | — | — |

Повторный вход в приложение (окно в фокусе) поднимает `refreshTick` и перезапрашивает live-источники без пересборки exe.

### Запуск для вкладки «Сегодня» (Outlook COM + 1С COM)

1. Backend: `constructor-gateway` на `:7812` (infra `docker compose up -d constructor-gateway`).
2. Orchestrator Electron: `orchestrator/orchestrator/desktop-electron/run_dev.bat` (не Turbobot `Consturctor/desktop/run_dev.bat` — там нет `window.agent`).
3. После правок **preload/main/pybridge** — полностью закрыть окно Electron и снова `run_dev.bat` (hot-reload renderer не подхватывает preload).
4. Outlook/1С COM: локально установлены Outlook и клиент 1С; sidecar вызывает `orchestrator/desktop` AC workers.
5. `DOCFLOW_ODATA_*` не обязательны, если задачи подтягиваются через `onec.search_tasks` (COM) после сбоя OData документооборота; erp_pm по-прежнему через gateway (`onec.erp_tasks_current`).

### Быстрые действия вкладки «Процессы» (`specGridQuickActions.ts`)

| Кнопка | Действие |
|--------|----------|
| Запустить новый процесс | клик по `SpecQuickLaunchButton` в `.orch-grid-header-actions` |
| Создать задачу в 1С | `invokeLocalAcTool('onec.search_tasks', { mine_only: true, limit: 1 })` — COM-сессия |
| Открыть календарь Outlook | `workspace.powershell_run`: Outlook COM `ShowFolder` (календарь) или `Start-Process outlook` |
| Перейти в 1С | `invokeLocalAcTool('onec.search_tasks', { mine_only: true, limit: 1 })` |

## Вопросы к владельцу продукта

1. Endpoint глобального поиска или только фильтр текущей таблицы?
2. ~~Письма: ждём Outlook COM или достаточно IMAP?~~ На «Сегодня» — Outlook COM по дню; IMAP остаётся на вкладке «Почта».
3. KB: отдельный сервис или только Constructor workflows?
4. KPI/History: приоритет pixel-perfect графиков vs табличные данные?
