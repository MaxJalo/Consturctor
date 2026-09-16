# Локальный стенд: задачи ERP (SQL) + OData erp_pm

Отдельно от Electron и от LAN gateway `192.168.1.157:7812` (там часто старый `_query_tasks` → `count: 0`).

## Что нужно

| Где | Переменные (имена) | Назначение |
|-----|-------------------|------------|
| workspace `.env` | `MY_NAME`, `MY_PASSWORD`, опц. `MY_NAME_MAIL` | ФИО для SQL/HTTP-probe |
| `backend/.env` | `ERP_SQL_*` (уже есть), `ODATA_BASE_URL`, `ODATA_TIMEOUT_SEC`, `ODATA_USERNAME` + `ODATA_PASSWORD` **или** `ERP_LOGIN` + `ERP_PASSWORD` | SQL + OData erp_pm |
| VPN | — | Доступ к `ii1` / `erp_pm` с вашего ПК, если SQL идёт локально |

### Windows: ошибка SQL `IM002` / «Источник данных не найден»

На домашнем или офисном ПК **без VPN** имя `ii1` не резолвится, а драйвер ODBC может быть не установлен — `_query_tasks` падает с **IM002**.

Что сделать для **локального SQL**:

1. Подключить VPN (как для доступа к `erp_pm`).
2. Установить **ODBC Driver 17 for SQL Server** или **18** (должен совпадать с `ERP_SQL_DRIVER` в `backend/.env`, обычно Driver 18).
3. Оставить `ERP_SQL_SERVER=ii1` (не `localhost` и не сырой IP при `ERP_SQL_TRUSTED_CONNECTION=yes` — иначе 18452).

Если SQL на этом ПК не нужен — см. **OData-only** и **HTTP через gateway** ниже.

### OData: учётные данные в `backend/.env`

`ODATA_BASE_URL` уже задан. Для пробы OData раскомментируйте **один** блок (значения только локально, не в git):

- `ODATA_USERNAME` + `ODATA_PASSWORD` (сервисный пользователь OData в erp_pm), **или**
- `ERP_LOGIN` + `ERP_PASSWORD` (тот же логин 1С, что в desktop).

Не задавайте оба блока сразу — достаточно одного.

Документооборот (`DOCFLOW_ODATA_*`, `/doc`) для **задач erp_pm** не обязателен.

### Desktop «Сегодня → Задачи из 1С»

При `BACKEND_URL=http://127.0.0.1:7812` Orchestrator вызывает server tool **`onec.erp_tasks_odata`** (исполнитель + ФИО в теме через OData, затем merge с SQL `_query_tasks` если `fallback_sql=true`). На LAN gateway (`192.168.1.157`) по-прежнему **`onec.erp_tasks_current`**. Принудительный режим: `VITE_ERP_TASKS_SOURCE=odata` или `sql` в `.env` desktop.

`run_dev.bat` уже выставляет `AUTH_SKIP_SESSION_LOCK=1` (переключение LAN ↔ localhost без 401).

## 1. Backend на :7812 (опционально для HTTP)

```powershell
cd orchestrator\backend
.\run_dev.bat
```

```powershell
curl http://127.0.0.1:7812/health
```

Ожидается `"erp_reachable":true` при VPN и `ERP_SQL_SERVER=ii1`.

## 2. Скрипт без Electron (SQL + OData)

```powershell
cd orchestrator
py -3.12 scripts\test_erp_tasks_local_odata.py
```

С проверкой через живой API:

```powershell
py -3.12 scripts\test_erp_tasks_local_odata.py --http
```

Только SQL:

```powershell
py -3.12 scripts\test_erp_tasks_local_odata.py --skip-odata
```

### OData-only (без ODBC / без VPN на ПК)

Проверка OData к erp_pm и (опционально) **новой relevance-логики на уже задеплоенном gateway** — SQL на вашем Windows не нужен:

```powershell
cd orchestrator
py -3.12 scripts\test_erp_tasks_local_odata.py --odata-only
```

После деплоя backend на LAN gateway (`192.168.1.157:7812`) — HTTP-probe без локального SQL:

```powershell
py -3.12 scripts\test_erp_tasks_local_odata.py --odata-only --http --backend-url http://192.168.1.157:7812
```

Нужны `MY_NAME` / `MY_PASSWORD` в workspace `.env` для `--http` (логин в API). На gateway должен быть актуальный `_query_tasks` / `build_task_user_relevance_clause`.

## 3. Ожидание для Жалыбин Максим Дмитриевич

При `MY_NAME=Жалыбин Максим Дмитриевич` и актуальном `build_task_user_relevance_clause` (исполнитель **или** ФИО в теме/комментарии):

- `_query_tasks` / `list_current_tasks`: **≥ 1** открытая задача, среди них **`00-Л-000040259`**
- `expect '00-Л-000040259' in SQL open list: True`
- `--http`: `invoke ok: True`, `count:` ≥ 1, та же задача в списке

OData (`Task_ЗадачаИсполнителя`): может показать **0** по фильтру «только исполнитель», если задача попала по **теме** — это нормально; сравнение SQL vs OData как раз для этого теста.

## 4. Сравнение с gateway

```powershell
cd orchestrator\backend
py -3.12 scripts\_probe_http_erp_once.py
```

`PROBE_LOCAL=http://127.0.0.1:7812` vs `PROBE_LAN=http://192.168.1.157:7812`.

## Связанные файлы

- `app/services/erp_tasks.py` — `_query_tasks`, `build_task_user_relevance_clause`
- `scripts/_probe_erp_my_tasks_report.py` — расширенный отчёт в `orchestrator/output/`
- `docs/DEPLOY_CONSTRUCTOR_GATEWAY.md` — деплой LAN gateway
