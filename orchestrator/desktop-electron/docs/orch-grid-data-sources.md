# Источники данных для UI сетки 9×9

По умолчанию v1: **mock** там, где нет API; пометка в UI через `data-origin="mock"` (dev) — TBD.

| Элемент | Статус v1 | Источник |
|---------|-----------|----------|
| Метрики «Процессы» | live | `useSpecV04Sources`, `buildProcessTiles` |
| Таблица процессов | live | agents + 1C + Turbo + Outlook mail + Outlook meetings |
| Задачи 1С | live | **`onec.erp_tasks_current` only** (gateway SQL `_query_tasks` + docflow merge на backend). COM `onec.search_tasks` — только при `VITE_ONEC_COM_TASKS_FALLBACK=1` и пустом SQL |
| Проекты | live | `turboproject.get_user_portfolio` (source id `turboproject`) |
| Письма (вкладка «Почта» / процессы) | live | `outlook.search_mail` (COM): `folder=All`, `date_from`/`date_to` = текущая неделя (пн…вс), `max_results=50`; sidecar `agent:search-mail` |
| Письма («Сегодня» → Outlook) | live | `outlook.search_mail`: `folder=Inbox`, `date=YYYY-MM-DD` (день = «Период») |
| Совещания | live/partial | `ensureOutlookMeetings` |
| База знаний | partial | `api.listWorkflows()` (регламенты Constructor) |
| KPI «Сегодня» (5 плиток) | live/partial | `useTodayKpiData` → `useSpecV04Sources` (см. ниже) |
| Сегодня → «Результаты дня» | live | `useTodayAgentResults` → `GET /api/v1/workflows/files` (`listPlatformFiles`), фильтр: `source=agent`, день = «Период», скачивание `api.download` |
| Сегодня → «Подготовленные решения» | live | `useTodayPreparedDecisions` (день = «Период», scope = пользователь): доска `useWorkplaceData` + `useRuns` (live HITL / `WAITING_HUMAN`) + `extractToolDecisions` по прогонам за день (`listAgentRuns` / `getAgentRunDetail`) + файлы агентов без вердикта (`listPlatformFiles`, как «Результаты дня»); подзаголовок — `intent`/`result` инструмента, `summary`/`agentTitle` файла или итог прогона (`run.summary` / `cleanRunResult`); пустой список без demo; mock `TODAY_PREPARED_DECISIONS` не используется |
| Сегодня → «Проектные задачи» | live | `useTodayProjectTasks`: портфель + до 5× `get_project_tasks` (open); **pin** `VITE_TURBO_PIN_FILE_IDS=363`; для pin — все open-задачи, не только «на день» |
| Сегодня → «Задачи из 1С» | live | `fetchOrchestratorTaskSources` → `erp_pm`; KPI hint `sources.erp` |
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
| Задачи 1С | `onec.erp_tasks_current` | erp_pm SQL (`_query_tasks`); source label `erp_pm`; COM opt-in `VITE_ONEC_COM_TASKS_FALLBACK=1`; вкладка «Задачи» — `erpError` в hint |
| Регламентные работы | `useWorkplaceData` agents (!standalone) | count + выполненные по статусу процесса |
| Проекты | `turboproject.get_user_portfolio` | count портфеля |
| События дня | `ensureOutlookMeetings` + `meetingCountToday` | только встречи на текущий день |
| History journal count | mock | audit API — TBD |
| Decisions comparison table | mock | payload агента — TBD |
| Project calendar (bottom) | mock | TurboProject events tool — TBD |

### Обновление данных (`GridDataRefreshProvider` + `gridDataCache`)

TTL кэша: **10 мин** (`GRID_DATA_TTL_MS = 600_000`). Смена вкладки **не** поднимает `generation` — повторный fetch только если кэш протух или изменились локальные deps (день, портфель, runs).

| Область | Где живёт | Смена user | Focus после blur / visibility | Interval 10 мин | События |
|---------|-----------|------------|-------------------------------|-----------------|---------|
| `SpecV04SourcesProvider` → `fetchOrchestratorTaskSources` (`orchestratorTaskSources.ts`) | App | да | да | да | — |
| `useWorkplaceData` (доска) | hook + module cache | да | да | да | `onBoardUpdated` (всегда reload) |
| `useTodayOutlookMail` | hook + cache | — (`periodDay` в deps) | да | да | — |
| `useTodayAgentResults` | hook + cache | — | да | да | `files_updated`, poll 60 с |
| `useTodayPreparedDecisions` | hook + cache | — | да | да | `files_updated`, `useRuns`, poll 60 с |
| `useTodayProjectTasks` | hook + cache | — | да | да | — |
| `useTodayPlanTimeline` | hook + cache | — | да | да | — |

Повторный вход в приложение поднимает `generation` и перезапрашивает live-источники без пересборки exe.

### Запуск для вкладки «Сегодня» (Outlook COM + 1С COM)

1. Backend: `constructor-gateway` на `:7812` (infra `docker compose up -d constructor-gateway`).
2. Orchestrator Electron: `orchestrator/orchestrator/desktop-electron/run_dev.bat` (не Turbobot `Consturctor/desktop/run_dev.bat` — там нет `window.agent`).
3. После правок **preload/main/pybridge** — полностью закрыть окно Electron и снова `run_dev.bat` (hot-reload renderer не подхватывает preload).
4. Outlook/1С COM: локально установлены Outlook и клиент 1С; sidecar вызывает `orchestrator/desktop` AC workers.
5. **Учётка 1С:** после входа в Orchestrator пароль хранится только в памяти renderer (`setComCredentials`) и уходит в gateway (`fio` + `password` в теле `invoke`) и в COM sidecar (`agent:ready` + каждый `onec.*` invoke). JWT — только идентификация пользователя, не пароль 1С.
6. **Dev backend:** для **задач 1С** предпочтителен `http://127.0.0.1:7812` (`orchestrator/backend/run_dev.bat`, VPN до `erp_pm`). LAN `192.168.1.157:7812` (constructor-gateway) часто **отстаёт по коду** — `onec.erp_tasks_current` возвращает `count: 0` без ошибки, хотя локальный backend с актуальным `erp_tasks.py` видит задачи (например `00-Л-000040259`). **Деплой LAN:** на сервере gateway — `docker compose up -d --build constructor-gateway` из каталога `infra` репозитория (см. `RegAgent/README.md`); образ должен собираться из текущего `orchestrator/backend`. После смены `BACKEND_URL` — повторный вход (JWT привязан к backend). В workspace `.env` — `MY_*` для dev-fallback (main → `setDevGatewayCredentials`). Пустой `get_user_portfolio` не блокирует pin `VITE_TURBO_PIN_FILE_IDS=363`.
6. `DOCFLOW_ODATA_*` / `ERP_*` на gateway — **fallback**, если сеанс восстановлен по token без повторного ввода пароля или invoke без `password`.

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
