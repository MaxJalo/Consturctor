"""Seed published agent «Проверка поручений к закрытию» (Cursor SDK playbook).

Creates (or updates, idempotent by owner + title + phase=done) a workflow that:
  - reads open АСТ00 assignments with lines and files from 1C ERP (onec.erp_assignments),
  - downloads and reads the artifacts from the «Файлы» tab (onec.download_artifact,
    office.read_file, excel.read_workbook), one file at a time and with a page limit,
  - links every line (мероприятие) to the executor's 1С:Документооборот task (include_tasks),
  - grades every line as done / partial / not confirmed and proposes a task action
    (close / return for rework / wait); the assignment can be closed only when every line is done,
  - saves the result as Проверка_артефактов_АСТ00_<date>.docx via report.export_document,
    written in parts (append) so the per-line section is not lost.

Read-only for 1C: the agent never changes assignment status.

Published to the Agent Library: phase=done, local_run.published=True,
status=published, purpose=functional.

Usage (from backend/):
  py -3.12 scripts/seed_assignment_closure_agent.py --user "Жалыбин Максим Дмитриевич"
  py -3.12 scripts/seed_assignment_closure_agent.py --user <user-id>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from uuid import uuid4

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy.orm.attributes import flag_modified

from app.db.session import SessionLocal, init_db
from app.models.user import AppUser
from app.models.workflow import Workflow
from app.services.admin_access import resolve_admin_access
from app.services.triggers.service import workflow_is_deleted

TITLE = "Проверка поручений к закрытию"

GOAL = (
    "Проверить незакрытые поручения АСТ00 в 1С ERP: по файлам во вкладке «Файлы» "
    "оценить, есть ли основания для закрытия, и выдать отчёт Word "
    "«Проверка артефактов по незакрытым поручениям АСТ00»."
)

TOOLS = [
    "onec.erp_assignments",
    "onec.download_artifact",
    "office.read_file",
    "excel.read_workbook",
    "report.export_document",
    "users.current",
]

INSTRUCTIONS = """Ты — агент «Проверка поручений к закрытию». Проверь незакрытые поручения журнала АСТ00 в 1С ERP и выдай отчёт Word. В 1С ничего не меняй: статусы поручений не трогай, только читай.

1. Период и список. Если в задании указан период (даты с/по), бери поручения этого периода; иначе — все открытые. Вызови onec.erp_assignments action="list" с only_open=true, include_files=true, include_tasks=true, include_last_day=false, limit=100 (и date_from / date_to, если период передан). В ответе у каждого поручения есть number, date, status, topic, basis, reporter, due, overdue, lines (пункт, исполнитель, срок, просрочка), files (name, extension, size, created, ref_key) и задачи 1С:Документооборот: у каждой строки lines — docflow_tasks (задачи «Исполнить задачу №N» исполнителя и проверка автора: kind execute/check, performer, executed, due, report — отчёт исполнителя, task_id) и docflow_state (label — где мероприятие по маршруту, returns — сколько раз возвращали, executor_report, open_check_task_id, open_execute_task_id); у поручения — docflow_tasks_assignment (задачи по поручению целиком). Если в ответе есть docflow_note — видны только открытые задачи, выполненных нет: так и напиши в отчёте. Повторно список не запрашивай. Если 1С не ответила — один повтор; снова ошибка — напиши человеку «1С недоступна» и остановись, отчёт не создавай.
2. Отбор файлов. По каждому поручению разбери files до чтения:
   — дубли (одинаковые name и size) читай один раз;
   — «Лист Microsoft Excel» и сканы, созданные в день регистрации поручения (created в дату поручения), обычно бланк самого поручения — прочитай один такой файл на всё поручение, чтобы подтвердить, остальные не открывай;
   — .epf, .zip и прочие нечитаемые — не скачивай, только упомяни в отчёте;
   — поручение без файлов — все мероприятия «Не подтверждено», вывод «Нельзя закрыть — нет оснований», файлы не ищи.
3. Чтение артефактов. Для отобранного файла: onec.download_artifact(file_id=ref_key файла) → saved_path; затем по расширению: doc/docx/pdf/pptx/jpg/png — office.read_file(filename=saved_path, max_pages=2, max_chars=8000); xlsx — excel.read_workbook(filename=saved_path). Читай по одному файлу за раз, не больше 3 файлов на поручение и не больше 25 файлов за запуск; сканы — не больше 2 страниц на файл. Встроенные Read / Grep / Glob для этих файлов не используй. Из каждого файла запиши 1–2 строки: что это за документ и что он подтверждает (дата, подпись, утверждение, номер).
4. Вывод по каждому мероприятию. Мероприятия — это пункты поручения (lines); если lines пустой, мероприятие одно — тема поручения. По каждому мероприятию отдельно дай вывод:
   — «Выполнено» — есть документ с результатом именно этого мероприятия (утверждён, подписан, принят, отправлен — с датой или номером);
   — «Частично» — результат есть, но не полный: черновик, нет утверждения или отметки «Принято», сделана только часть, документ фиксирует проблему (расхождение, отказ);
   — «Не подтверждено» — по этому мероприятию в файлах ничего нет (бланк поручения и копия основания результатом не считаются).
   К каждому выводу — чем подтверждено: имя файла и что в нём (дата, подпись, номер) или «артефактов нет». Один документ может подтверждать несколько мероприятий, но только если в нём явно есть результат по каждому. Ничего не домысливай: только то, что есть в файлах, карточке 1С и задачах Документооборота.
   Задача Документооборота — второй источник. docflow_state «принято проверяющим» — мероприятие принято в ДО: это «Выполнено», даже без файла (подтверждение — «принято в ДО <дата>, <проверяющий>»). Отчёт исполнителя (executor_report) с конкретным результатом (номер, дата, документ) подтверждает мероприятие вместе с файлом; отчёт без результата («выполнено», «сделано») сам по себе — не больше «Частично».
   Предлагаемое действие по задаче мероприятия (в 1С ничего не делай, только предложи):
   — «Закрыть задачу» — мероприятие «Выполнено» и есть открытая проверка (open_check_task_id);
   — «Вернуть на доработку: <чего не хватает>» — мероприятие «Частично» или «Не подтверждено», а исполнитель уже отчитался (открытая проверка или задача исполнителя выполнена);
   — «Ждать исполнителя» — задача у исполнителя, не выполнена (если срок прошёл — «Ждать исполнителя, срок прошёл»);
   — «Уже принято» — docflow_state «принято проверяющим»;
   — «Задачи в ДО нет» — docflow_tasks пустой.
5. Общий вывод по поручению. Поручение можно закрыть, только когда выполнены ВСЕ его мероприятия:
   — «Можно закрыть» — все мероприятия «Выполнено»;
   — «Нельзя закрыть — выполнено частично» — хотя бы одно мероприятие «Выполнено» или «Частично», но не все «Выполнено»;
   — «Нельзя закрыть — нет оснований» — все мероприятия «Не подтверждено» (в том числе поручение без файлов).
   Обоснование — 1–3 предложения: сколько мероприятий выполнено из скольких и какие именно не выполнены (номер пункта и чего не хватает).
6. Отчёт Word пиши частями: один огромный вызов обрывается, и раздел мероприятий теряется. Все вызовы report.export_document — с одним и тем же filename="Проверка_артефактов_АСТ00_<сегодня YYYY-MM-DD>", format="docx".
   Первый вызов (без append): title="Проверка артефактов по незакрытым поручениям АСТ00", kpis, summary и sections=[«Вывод по поручениям»].
   Затем append=true, по 3 поручения за вызов, пока не опишешь все: sections=[{heading:"Мероприятия: <номер>, <номер>, <номер>", body: блоки этих поручений, как описано ниже для «Мероприятия поручений»}]. Не пропускай поручения: в Word должны быть мероприятия каждого поручения из таблицы вывода.
   Структура:
   — kpis: [{label:"Всего открытых", value}, {label:"Можно закрыть", value}, {label:"Выполнено частично", value}, {label:"Нет оснований", value}, {label:"Просрочено", value}, {label:"Без файлов", value}] — посчитай по общим выводам и полю overdue;
   — summary: «Дата: <сегодня>. Источник: 1С ERP, Document_ТД_Поручения (серия АСТ00, статусы «Создано» и «В работе», N поручений), вкладка «Файлы» каждого поручения и задачи исполнителей в 1С:Документооборот. Период: <период или «все открытые»>. Поручение считается готовым к закрытию, только если выполнены все его мероприятия.» (+ « Задачи ДО — только открытые, из последней выгрузки.», если был docflow_note);
   — sections[0] heading «Вывод по поручениям», body — markdown-таблица с колонками | Номер | Тема | Срок | Просрочка | Исполнители | Мероприятий выполнено | Вывод | Обоснование |, по строке на поручение; «Мероприятий выполнено» — «2 из 3»; порядок: «Можно закрыть», «Нельзя закрыть — выполнено частично», «Нельзя закрыть — нет оснований», внутри — по номеру по убыванию. Срок — ДД.ММ.ГГГГ или «не задан»; Просрочка — «да» / «нет» / «нет (п.1–2 просрочены)»; Исполнители — докладчик / исполнители пунктов, фамилия И.О.;
   — «Мероприятия поручений» (разделы append) — по каждому поручению в том же порядке: строка «### <номер> от <ДД.ММ.ГГГГ> — <тема>», строка «**Статус:** <статус>; срок <срок>; докладчик <ФИО>; **вывод:** <общий вывод>», строка «Основание: <basis>» (если это не GUID), markdown-таблица | № | Мероприятие | Исполнитель | Срок | Задача в ДО | Вывод | Чем подтверждено | Предлагаемое действие | по каждому мероприятию (просроченный срок — «ДД.ММ.ГГГГ (просрочен)», пустой исполнитель — исполнитель задачи ДО или «не назначен»; «Задача в ДО» — docflow_state.label и «возвратов: N», если returns > 0), затем строка «**Файлы:** имя.расширение (ДД.ММ.ГГГГ); …» или «**Файлы:** нет».
   Текст пиши полностью, без сокращений и без «…». Файл пиши только этим инструментом.
7. Итог человеку в чате: общая сводка (сколько поручений можно закрыть и их номера), затем по каждому поручению заголовок «<номер> — <общий вывод> (N из M)» и под ним список мероприятий: «п.<N> <мероприятие коротко> — <вывод>; задача ДО: <статус>; действие: <предлагаемое действие>». Имя файла — из ответа последнего вызова report.export_document. В блоке FILES итогового WORK_RESULT укажи только этот файл.
8. Разбор для реестра поручений. Самым последним в WORK_RESULT, после FILES, выведи блок ```closure-check с JSON {"assignments": [...]}: по нему реестр поручений покажет вывод по каждому поручению и мероприятиям, а у мероприятий — кнопки «Закрыть задачу» / «Вернуть на доработку». Решение принимает человек, сам ничего не закрывай. В блок — ВСЕ проверенные поручения в том же порядке, что в таблице вывода, и все их мероприятия. Пиши компактно, одной строкой на объект, без пояснений внутри блока.
   Поручение: number, target_id (= ref_key поручения), conclusion (общий вывод дословно: «Можно закрыть» / «Нельзя закрыть — выполнено частично» / «Нельзя закрыть — нет оснований»), done, total (мероприятий выполнено / всего), reason (1 предложение), lines.
   Мероприятие (lines): line (номер пункта), event (до 80 символов), executor (фамилия И.О.), conclusion («Выполнено» / «Частично» / «Не подтверждено»), evidence (чем подтверждено, до 120 символов), task_state (= docflow_state.label), advice (предлагаемое действие текстом, как в отчёте). У каждого мероприятия с conclusion «Частично» или «Не подтверждено» — comment, даже без action: замечание исполнителю для возврата на доработку, 1–2 предложения до 250 символов, на «вы», по существу этого пункта — что не так в том, что ты нашёл (какой файл не подходит и почему, чего не хватает), и что приложить или доделать. Не пиши общих фраз вроде «приложите подтверждение»: назови документ (например, «Во вкладке «Файлы» только бланк поручения. Приложите подписанный акт приёмки работ по договору с ООО «Дорстрой»»). Если предлагаешь «Закрыть задачу» или «Вернуть на доработку» и у строки есть docflow_state.open_check_task_id, добавь: action ("close" или "return"), task_id (= open_check_task_id), step (= open_check_step), title (= open_check_name), reason (1 предложение: почему). task_id, step, title и target_id копируй из ответа onec.erp_assignments дословно, не придумывай; нет open_check_task_id — нет action. Если задача у исполнителя и есть docflow_state.open_execute_task_id — добавь open_task_id (= open_execute_task_id, дословно): по нему человек откроет карточку задачи.
   Пример:
```closure-check
{"assignments":[
{"number":"АСТ00-00092","target_id":"<ref_key>","conclusion":"Нельзя закрыть — выполнено частично","done":1,"total":2,"reason":"П.2: извещение о вводе не подписано.","lines":[
{"line":1,"event":"Утвердить СТО-231","executor":"Иванов И.И.","conclusion":"Выполнено","evidence":"СТО-231 ред. 2 от 21.09.2026, утверждён","task_state":"принято проверяющим","advice":"Уже принято"},
{"line":2,"event":"Ввести СТО-231 в действие","executor":"Иванов И.И.","conclusion":"Частично","evidence":"извещение без подписи","task_state":"исполнитель отчитался, ждёт проверки","advice":"Вернуть на доработку","action":"return","task_id":"<open_check_task_id>","step":"<open_check_step>","title":"<open_check_name>","reason":"Извещение о вводе не подписано","comment":"Извещение о вводе СТО-231 в действие приложено без подписи директора. Приложите подписанный скан извещения."}]},
{"number":"АСТ00-00094","target_id":"<ref_key>","conclusion":"Нельзя закрыть — нет оснований","done":0,"total":1,"reason":"Файлов нет.","lines":[
{"line":1,"event":"Подготовить акт сверки с ООО «Вектор»","executor":"Петров П.П.","conclusion":"Не подтверждено","evidence":"артефактов нет","task_state":"у исполнителя, не выполнено","advice":"Ждать исполнителя","open_task_id":"<open_execute_task_id>","comment":"Во вкладке «Файлы» нет акта сверки. Приложите акт сверки с ООО «Вектор», подписанный обеими сторонами."}]}
]}
```
"""

EXAMPLE_RUN = """Задача: «Проверь незакрытые поручения АСТ00 за период 2026-03-25 — 2026-09-25».
1. onec.erp_assignments(action="list", only_open=true, include_files=true, include_tasks=true, include_last_day=false, limit=100, date_from="2026-03-25", date_to="2026-09-25") → 15 открытых поручений с пунктами, файлами и задачами ДО по пунктам.
2. Отбор: АСТ00-00097 — 14 файлов, из них 6 дублей и бланк; читаю письмо в ЖКХ и один скан. АСТ00-00094 — файлов нет → все мероприятия «Не подтверждено». АСТ00-00039 — ТД_БДРНовая.epf не скачиваю.
3. АСТ00-00093: onec.download_artifact(file_id="106692b3-…") → Лист записи ЕГРЮЛ_ОКВЭД.pdf; office.read_file(filename=saved_path, max_pages=2) → «лист ЕГРЮЛ 15.09.2026, основной ОКВЭД 30.30 у ООО «ИТЦ»». Всего прочитано 19 файлов.
4. Мероприятия АСТ00-00093: п.1 «Выполнено» — расписка ИФНС от 12.09.2026, задача ДО ждёт проверки → «Закрыть задачу»; п.2 «Выполнено» — лист ЕГРЮЛ от 15.09.2026, уже принято в ДО; п.3–6 «Не подтверждено» — артефактов нет, задачи у исполнителей → «Ждать исполнителя, срок прошёл». Мероприятия АСТ00-00092: п.1 «Выполнено» — финальная редакция СТО-231 от 21.09.2026; п.2 «Частично» — исполнитель отчитался, но извещение о вводе в действие не подписано → «Вернуть на доработку: приложить подписанное извещение».
5. Общий вывод: АСТ00-00093 — «Нельзя закрыть — выполнено частично» (2 из 6, не выполнены п.3–6). АСТ00-00092 — «Нельзя закрыть — выполнено частично» (1 из 2, п.2 без подписанного извещения). АСТ00-00088 — «Можно закрыть» (3 из 3).
6. report.export_document(filename="Проверка_артефактов_АСТ00_2026-09-25", format="docx", title="Проверка артефактов по незакрытым поручениям АСТ00", kpis=[Всего 15, Можно закрыть 1, Выполнено частично 4, Нет оснований 10, Просрочено 7, Без файлов 4], summary=…, sections=[Вывод по поручениям (md-таблица 15 строк)]); затем 5 вызовов с append=true и тем же filename: «Мероприятия: АСТ00-00088, АСТ00-00093, АСТ00-00092» и т.д. (###, статус, таблица мероприятий с задачей ДО, выводом, подтверждением и действием, файлы) → Проверка_артефактов_АСТ00_2026-09-25.docx.
7. Сводка человеку: можно закрыть — АСТ00-00088; по каждому поручению список мероприятий с выводом, статусом задачи ДО и действием. FILES: Проверка_артефактов_АСТ00_2026-09-25.docx.
8. Последним — блок ```closure-check: все 15 поручений с выводом и мероприятиями; у 00093 п.1 (Тен Л.Л.) action close, у 00092 п.2 (Иванов И.И.) action return с комментарием «приложить подписанное извещение».
"""

STEPS = [
    {"id": "s1", "title": "Открытые поручения АСТ00", "tool": "onec.erp_assignments", "action": "action=list, only_open=true, include_files=true, include_tasks=true, include_last_day=false, limit=100 (+ date_from/date_to периода). Один запрос; 1С недоступна — остановиться."},
    {"id": "s2", "title": "Отбор файлов", "action": "Дубли читать один раз; бланк поручения — один на поручение; .epf/.zip не скачивать; без файлов — все мероприятия «Не подтверждено»."},
    {"id": "s3", "title": "Чтение артефактов", "tool": "onec.download_artifact", "tool_candidates": ["office.read_file", "excel.read_workbook"], "action": "По одному файлу: download → office.read_file (max_pages=2, max_chars=8000) или excel.read_workbook. ≤3 файлов на поручение, ≤25 за запуск."},
    {"id": "s4", "title": "Вывод по каждому мероприятию", "action": "По каждому пункту lines: Выполнено / Частично / Не подтверждено + чем подтверждено (файл, задача ДО, отчёт исполнителя) + предлагаемое действие по задаче ДО (закрыть / вернуть на доработку / ждать исполнителя)."},
    {"id": "s5", "title": "Общий вывод по поручению", "action": "Можно закрыть — только если все мероприятия «Выполнено»; иначе «Нельзя закрыть — выполнено частично» или «Нельзя закрыть — нет оснований»; обоснование: N из M и какие пункты не выполнены."},
    {"id": "s6", "title": "Отчёт Проверка_артефактов_АСТ00_<дата>.docx", "tool": "report.export_document", "action": "Частями, один filename: первый вызов — kpis, summary, «Вывод по поручениям»; затем append=true по 3 поручения — таблицы мероприятий (задача ДО, вывод, подтверждение, действие)."},
    {"id": "s7", "title": "Итог человеку", "action": "Какие поручения можно закрыть; по каждому поручению — мероприятия с выводом, задачей ДО и действием; FILES — только созданный файл."},
    {"id": "s8", "title": "Разбор для реестра", "action": "Последним в WORK_RESULT — блок ```closure-check (JSON): все поручения с выводом и мероприятиями; у каждого «Частично» / «Не подтверждено» — comment исполнителю (что не так и что приложить); action/task_id/step/title только при open_check_task_id, дословно из ответа 1С. Сам ничего не закрывать."},
]


def _playbook() -> dict:
    return {
        "name": TITLE,
        "goal": GOAL,
        "instructions": INSTRUCTIONS.strip(),
        "example_run": EXAMPLE_RUN.strip(),
        "steps": STEPS,
        "tools": TOOLS,
    }


def _find_user(db, query: str) -> AppUser | None:
    query = (query or "").strip()
    if not query:
        return None
    user = db.get(AppUser, query)
    if user is not None:
        return user
    user = db.query(AppUser).filter(AppUser.fio == query).first()
    if user is not None:
        return user
    return db.query(AppUser).filter(AppUser.fio.ilike(f"%{query.split()[0]}%")).first()


def _first_admin(db) -> AppUser | None:
    for user in db.query(AppUser).order_by(AppUser.created_at.asc()).all():
        if resolve_admin_access(db, user.id) is not None:
            return user
    return None


def _find_existing(db, user_id: str) -> Workflow | None:
    rows = (
        db.query(Workflow)
        .filter(Workflow.user_id == user_id, Workflow.title == TITLE, Workflow.phase == "done")
        .order_by(Workflow.updated_at.desc())
        .all()
    )
    for row in rows:
        if not workflow_is_deleted(row):
            return row
    return None


def _apply_playbook(row: Workflow) -> None:
    """Write the current playbook/tools into a workflow row (owner or adopted copy)."""
    local = dict(row.local_run or {})
    local["playbook"] = _playbook()
    local["published"] = True
    local["status"] = "published"
    local["purpose"] = "functional"
    local["tools"] = TOOLS
    # Daily 7:00 check runs on the backend: the owner's Orchestrator may be closed.
    local["run_on_server"] = True
    local.pop("kind", None)
    local.pop("unformed", None)
    # An old artifact-close draft and a resumed Cursor chat both carry the previous verdicts.
    local.pop("playbook_draft", None)
    local.pop("sdk_agent_id", None)
    row.local_run = local

    plan = dict(row.plan_json or {})
    plan["title"] = TITLE
    plan["goal"] = plan.get("goal") or GOAL
    runtime = dict(plan.get("runtime") or {})
    runtime["tools"] = TOOLS
    plan["runtime"] = runtime
    row.plan_json = plan

    row.phase = "done"
    if not (row.notes or "").strip():
        row.notes = GOAL
    flag_modified(row, "local_run")
    flag_modified(row, "plan_json")


def _adopted_copies(db, source_id: str) -> list[Workflow]:
    """Library copies other users adopted from the source row (local_run.library_source_id)."""
    rows = (
        db.query(Workflow)
        .filter(Workflow.title == TITLE, Workflow.phase == "done", Workflow.id != source_id)
        .all()
    )
    out: list[Workflow] = []
    for row in rows:
        if workflow_is_deleted(row):
            continue
        local = row.local_run if isinstance(row.local_run, dict) else {}
        if str(local.get("library_source_id") or "").strip() == source_id:
            out.append(row)
    return out


def seed(*, user_query: str) -> None:
    init_db()
    db = SessionLocal()
    try:
        if user_query:
            user = _find_user(db, user_query)
            if user is None:
                raise SystemExit(f"User not found: {user_query}")
        else:
            user = _first_admin(db)
            if user is None:
                raise SystemExit("No admin user found; pass --user explicitly")
        print(f"Owner: {user.fio} ({user.id})")

        row = _find_existing(db, user.id)
        created = row is None
        if row is None:
            row = Workflow(
                id=str(uuid4()),
                user_id=user.id,
                title=TITLE,
                phase="done",
                notes=GOAL,
            )
            db.add(row)

        _apply_playbook(row)
        db.flush()

        copies = _adopted_copies(db, row.id)
        for copy_row in copies:
            _apply_playbook(copy_row)

        db.commit()
        db.refresh(row)

        print(f"workflow_id: {row.id}")
        print("created" if created else "updated")
        for copy_row in copies:
            print(f"adopted copy synced: {copy_row.id} (user {copy_row.user_id})")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed assignment closure check agent (published)")
    parser.add_argument(
        "--user",
        default="",
        help="Owner: user id or FIO (default: first admin from ADMIN_FIO_KEYS)",
    )
    args = parser.parse_args()
    seed(user_query=args.user)


if __name__ == "__main__":
    main()
