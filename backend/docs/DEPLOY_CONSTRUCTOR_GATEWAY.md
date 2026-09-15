# Деплой constructor-gateway (192.168.1.157:7812)

Чеклист для админа сервера gateway. Пользователям desktop **не нужен VPN до erp_pm**, если `BACKEND_URL` указывает на LAN gateway — ODBC/SQL к 1С выполняется **на сервере** gateway, не на ПК клиента.

## Архитектура

```text
Orchestrator (ПК пользователя)
    → HTTP JWT → constructor-gateway :7812 (192.168.1.157)
                    → ERP SQL (ODBC) → ii1 / erp_pm
                    → OData docflow (по DOCFLOW_* / пароль из сессии)
```

Локальный dev-backend (`127.0.0.1:7812` + `run_dev.bat`) — только для разработки; на ПК разработчика тогда нужен VPN до `ii1`, если SQL идёт с его машины.

## 1. Переменные на сервере (контейнер / .env gateway)

На **хосте gateway** (Windows с доступом к SQL):

| Переменная | Пример | Комментарий |
|------------|--------|-------------|
| `ERP_SQL_SERVER` | `ii1` | Hostname, не сырой IP (Trusted Connection) |
| `ERP_SQL_DATABASE` | `erp_pm` | |
| `ERP_SQL_TRUSTED_CONNECTION` | `yes` | Windows Auth с учёткой службы контейнера/хоста |
| `DOCFLOW_ODATA_*` | … | Документооборот (по политике infra) |

Секреты `ERP_LOGIN` / `ERP_PASSWORD` — только если не используется Trusted Connection.

Postgres приложения (черновики, сессии): `DATABASE_URL` на `constructor-pg` (см. корневой `infra`).

## 2. Обновление кода

1. На сервере (или CI): актуальный репозиторий, каталог **`orchestrator/backend`**.
2. Минимум коммит **`6d0e958`** — Admin API (`/api/v1/admin/*`) и актуальный **`erp_tasks.py`** (`_query_tasks` / `build_task_user_relevance_clause`).
3. Сборка образа из текущего `orchestrator/backend` (не старый кэш).

Из каталога **`infra`** репозитория (если layout как в RegAgent):

```powershell
cd infra
docker compose up -d --build constructor-gateway
```

## 3. Проверки после деплоя

На любой машине в LAN:

```powershell
curl http://192.168.1.157:7812/health
```

Ожидается: `"status":"ok"`, `"erp_reachable":true`, `"erp_server":"ii1"`.

Admin (новый backend):

```powershell
curl -i http://192.168.1.157:7812/api/v1/admin/overview
```

Ожидается **HTTP 200**, не 404.

Задачи 1С (с тестовым пользователем):

```powershell
cd orchestrator\backend
python scripts\_probe_http_erp_once.py
```

Для LAN: `PROBE_LAN=http://192.168.1.157:7812` — в `.env` workspace задайте `MY_NAME`, `MY_PASSWORD` (ФИО как в 1С).  
Ожидается: `invoke ok: True`, `count:` **> 0** для пользователя с открытыми задачами (например Жалыбин).

**До деплоя** типичная картина: `erp_reachable: true`, `count: 0`, `source: erp_pm+…` — старый `_query_tasks` на gateway.

## 4. Клиенты (Orchestrator / RegAgent)

- `BACKEND_URL=http://192.168.1.157:7812`
- После смены backend — **повторный вход** (JWT привязан к инстансу).
- VPN на ПК пользователя **не требуется** для задач 1С через gateway.

## 5. Локальная разработка (без деплоя gateway)

Пока образ на 157 не обновлён, задачи проверяйте на **локальном** backend и VPN до `ii1`:

- `backend/docs/LOCAL_ERP_TASKS_ODATA.md`
- `orchestrator/scripts/test_erp_tasks_local_odata.py`

## 6. Связанные файлы

- `RegAgent/README.md` — первичный docker compose
- `orchestrator/backend/README.md` — ERP_SQL, auth
- `orchestrator/desktop-electron/run_dev.bat` — dev на LAN 157 по умолчанию
