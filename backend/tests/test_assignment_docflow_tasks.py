from app.services import assignment_docflow_tasks as tasks


def _item():
    return {
        "ref_key": "b75214dc-a846-11f1-9877-6cb31113810c",
        "lines": [
            {"line": 1, "text": "1. Подать заявление в ИФНС", "executor": "Тен Л.Л."},
            {"line": 2, "text": "2. Получить документ из ИФНС", "executor": "Тен Л.Л."},
            {"line": 3, "text": "Сформировать шаблон договора", "executor": ""},
        ],
    }


def _row(task_id, name, performer, begin, executed=False, step="", description=""):
    return {
        "id": task_id,
        "name": name,
        "performer": performer,
        "author": "Ильченко Е.А.",
        "begin": begin,
        "due": "2026-10-01T00:00:00",
        "executed": executed,
        "step": step,
        "description": description,
    }


def test_tasks_are_linked_to_lines_by_number_and_route_state():
    item = _item()
    rows = [
        _row("t-check", "Проверить исполнение задачи №1", "Ильченко Е.А.", "2026-09-10", step="Проверить"),
        _row("t-exec", "Исполнить задачу №1", "Тен Л.Л.", "2026-09-01", True, "Исполнить", "Заявление подано, вх. 15"),
        _row("t-exec2", "Исполнить задачу №2", "Тен Л.Л.", "2026-09-01", step="Исполнить"),
        _row("t-doc", 'Исполнить "Поручения (ТД) АСТ00-00093"', "Солдатенко О.Н.", "2026-09-01"),
    ]

    tasks.link_tasks(item, rows)

    first, second, third = item["lines"]
    assert [t["task_id"] for t in first["docflow_tasks"]] == ["t-exec", "t-check"]
    assert first["docflow_state"]["label"] == "исполнитель отчитался, ждёт проверки"
    assert first["docflow_state"]["open_check_task_id"] == "t-check"
    assert first["docflow_state"]["executor_report"] == "Заявление подано, вх. 15"
    assert second["docflow_state"]["label"] == "у исполнителя, не выполнено"
    assert second["docflow_state"]["open_execute_task_id"] == "t-exec2"
    assert third["docflow_state"]["label"] == "задачи в Документообороте нет"
    assert [t["task_id"] for t in item["docflow_tasks_assignment"]] == ["t-doc"]


def test_accepted_line_and_rework_count():
    item = _item()
    rows = [
        _row("e1", "Исполнить задачу №1", "Тен Л.Л.", "2026-09-01", True, "Исполнить"),
        _row("c1", "Проверить исполнение задачи №1", "Ильченко Е.А.", "2026-09-02", True, "Проверить"),
        _row("e2", "Исполнить задачу №1", "Тен Л.Л.", "2026-09-03", True, "Исполнить"),
        _row("c2", "Проверить исполнение задачи №1", "Ильченко Е.А.", "2026-09-04", True, "Проверить"),
    ]

    tasks.link_tasks(item, rows)

    state = item["lines"][0]["docflow_state"]
    assert state["label"] == "принято проверяющим"
    assert state["returns"] == 1


def test_duplicates_and_deadline_tasks_do_not_change_route_state():
    item = {"ref_key": "x", "lines": [{"line": 1, "text": "Совет директоров"}]}
    rows = [
        _row("e1", "Исполнить задачу №1", "Ростовцева А.В.", "2026-06-01", step="Исполнить"),
        _row("e1", "Исполнить задачу №1", "Ростовцева А.В.", "2026-06-01", step="Исполнить"),
        _row("p1", "Согласовать перенос срока по задаче: Исполнить задачу №1", "Ильченко Е.А.", "2026-06-05", True, "Рассмотреть вопрос"),
        _row("w1", 'Проверить исполнение "Поручения (ТД) АСТ00-00039"', "Ильченко Е.А.", "2026-06-09", step="Проверить исполнение"),
    ]

    tasks.link_tasks(item, rows)

    line = item["lines"][0]
    assert [t["task_id"] for t in line["docflow_tasks"]] == ["e1", "p1", "w1"]
    assert line["docflow_tasks"][1]["kind"] == "other"
    assert line["docflow_state"]["returns"] == 0
    assert line["docflow_state"]["open_check_task_id"] == "w1"


def test_unnumbered_task_goes_to_line_of_its_performer():
    item = {
        "ref_key": "x",
        "lines": [
            {"line": 1, "text": "Проработать концепцию автоматизации", "executor": "Торотадзе Дмитрий Шотаевич"},
            {"line": 2, "text": "Проработать концепцию автоматизации", "executor": "Соломичева Светлана Викторовна"},
        ],
    }
    rows = [
        _row("s1", 'Исполнить "Поручения (ТД) АСТ00-00098"', "Соломичева Светлана Викторовна", "2026-09-23",
             step="Исполнить", description="Проработать концепцию автоматизации коммерческой службы и представить"),
    ]

    tasks.link_tasks(item, rows)

    assert item["lines"][1]["docflow_state"]["open_execute_task_id"] == "s1"
    assert item["lines"][0]["docflow_tasks"] == []


def test_one_unnumbered_task_covers_all_lines_of_its_performer():
    item = {
        "ref_key": "be3f4d62",
        "lines": [
            {"line": 1, "text": "Тест закрытия задачи в поручении", "executor": "Карташова Анастасия Эдуардовна"},
            {"line": 2, "text": "Тест возврата на доработку задачи в поручении", "executor": "Карташова Анастасия Эдуардовна"},
        ],
    }
    rows = [
        _row("k1", 'Исполнить "Поручения (ТД) АСТ00-00112 от 14.10.2026"', "Карташова Анастасия Эдуардовна",
             "2026-10-14T14:54:31", step="Исполнить"),
    ]

    tasks.link_tasks(item, rows)

    for line in item["lines"]:
        assert line["docflow_state"]["open_execute_task_id"] == "k1"
        assert line["docflow_state"]["label"] == "у исполнителя, не выполнено"
    assert item["docflow_tasks_assignment"] == []


def test_unnumbered_check_follows_executed_shared_task():
    item = {
        "ref_key": "x",
        "lines": [
            {"line": 1, "text": "Первое", "executor": "Карташова А.Э."},
            {"line": 2, "text": "Второе", "executor": "Карташова А.Э."},
        ],
    }
    rows = [
        _row("k1", 'Исполнить "Поручения (ТД) АСТ00-00112"', "Карташова А.Э.", "2026-10-14T14:54", True, "Исполнить"),
        _row("c1", 'Проверить исполнение "Поручения (ТД) АСТ00-00112"', "Ильченко Е.А.", "2026-10-14T15:10",
             step="Проверить исполнение"),
    ]

    tasks.link_tasks(item, rows)

    for line in item["lines"]:
        assert line["docflow_state"]["open_check_task_id"] == "c1"
        assert line["docflow_state"]["label"] == "исполнитель отчитался, ждёт проверки"


def test_without_session_password_falls_back_to_dump(monkeypatch):
    item = _item()
    monkeypatch.setattr(tasks, "_service_login", lambda: ("", ""))
    monkeypatch.setattr(
        "app.services.docflow_protocols._dump_open_rows",
        lambda refs: {refs[0]: [_row("e1", "Исполнить задачу №2", "Тен Л.Л.", "2026-09-01")]},
    )

    note = tasks.attach_docflow_tasks([item], {})

    assert "только открытые задачи" in note
    assert item["lines"][1]["docflow_tasks"][0]["task_id"] == "e1"
