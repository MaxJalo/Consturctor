from app.services import external_order_onec as onec

PARTY = "11111111-1111-1111-1111-111111111111"
MANAGER = "22222222-2222-2222-2222-222222222222"


def _docs(count: int) -> list[dict]:
    return [
        {
            "Ref_Key": f"{index:08d}-0000-0000-0000-000000000000",
            "Number": f"ТКП-{index:04d}",
            "Date": "2026-03-02T10:00:00",
            "Статус": "Согласовано",
            "Менеджер_Key": MANAGER,
        }
        for index in range(count)
    ]


def _fake(monkeypatch, docs: list[dict]) -> list[dict]:
    calls: list[dict] = []

    def fake_rows(client, entity, *, filt="", top=20, ref_key="", orderby="", skip=0, select=""):
        _ = (client, ref_key, orderby, select)
        calls.append({"entity": entity, "filt": filt, "top": top, "skip": skip})
        if entity == onec._CONTRACTOR:
            return [{"Ref_Key": PARTY}]
        if entity in {onec._TKP, onec._ORDER}:
            return docs[skip : skip + top]
        return []

    def fake_titles(client, entity, keys, *, number=False):
        _ = (client, number)
        return {MANAGER: "Иванов И. И."} if entity == onec._USER and MANAGER in keys else {}

    monkeypatch.setattr(onec, "_client", lambda: object())
    monkeypatch.setattr(onec, "_rows", fake_rows)
    monkeypatch.setattr(onec, "_titles", fake_titles)
    onec._tkp_pages.clear()
    onec._sale_pages.clear()
    return calls


def test_page_reads_one_page_from_1c(monkeypatch) -> None:
    calls = _fake(monkeypatch, _docs(120))
    page = onec.recent_tkp_page(skip=50, top=50)
    assert [item["number"] for item in page["orders"]][:2] == ["ТКП-0050", "ТКП-0051"]
    assert len(page["orders"]) == 50 and page["has_more"] is True
    page_calls = [call for call in calls if call["entity"] == onec._TKP and call["filt"] == onec._POSTED]
    assert page_calls == [{"entity": onec._TKP, "filt": onec._POSTED, "top": 51, "skip": 50}]
    assert page["statuses"] == ["Согласовано"] and "Иванов И. И." in page["managers"]


def test_last_page_has_no_more(monkeypatch) -> None:
    _fake(monkeypatch, _docs(120))
    page = onec.recent_tkp_page(skip=100, top=50)
    assert len(page["orders"]) == 20 and page["has_more"] is False


def test_filters_go_to_odata(monkeypatch) -> None:
    calls = _fake(monkeypatch, _docs(5))
    onec.recent_tkp_page(top=50)
    onec.recent_tkp_page(
        top=50,
        filters={
            "q": "Альфа",
            "status": "Согласовано",
            "manager": "Иванов И. И.",
            "date_from": "2026-03-01",
            "date_to": "2026-03-31",
            "has_order": "yes",
        },
    )
    filt = [call for call in calls if call["entity"] == onec._TKP and "Статус eq" in call["filt"]][-1]["filt"]
    assert "Date ge datetime'2026-03-01T00:00:00'" in filt
    assert "Date le datetime'2026-03-31T23:59:59'" in filt
    assert "Статус eq 'Согласовано'" in filt
    assert f"Менеджер_Key eq guid'{MANAGER}'" in filt
    assert f"ЗаказКлиента_Key ne guid'{onec._EMPTY}'" in filt
    assert "substringof('Альфа', Number)" in filt and "substringof('Альфа', Комментарий)" in filt
    assert f"Контрагент_Key eq guid'{PARTY}'" in filt


def test_unknown_manager_returns_empty_page_without_tkp_query(monkeypatch) -> None:
    calls = _fake(monkeypatch, _docs(5))
    page = onec.recent_tkp_page(filters={"manager": "Нет такого"})
    assert page["orders"] == [] and page["has_more"] is False
    assert not [call for call in calls if call["entity"] == onec._TKP]


def test_several_words_must_each_match_number_or_comment(monkeypatch) -> None:
    calls = _fake(monkeypatch, _docs(3))
    onec.recent_tkp_page(filters={"q": "тендер 14"})
    filt = [call for call in calls if call["entity"] == onec._TKP and "substringof" in call["filt"]][-1]["filt"]
    assert "substringof('тендер', Number) or substringof('тендер', Комментарий)" in filt
    assert "substringof('14', Number) or substringof('14', Комментарий)" in filt


def test_sale_orders_page_reads_customer_orders(monkeypatch) -> None:
    calls = _fake(monkeypatch, _docs(3))
    page = onec.recent_sale_orders_page(top=50, filters={"q": "тендер"})
    assert page["orders"]
    assert page["orders"][0]["kind"] == "order"
    sale = [call for call in calls if call["entity"] == onec._ORDER and "Posted" in call["filt"]]
    assert sale and "Комментарий" in sale[0]["filt"]


def test_page_cache_and_refresh(monkeypatch) -> None:
    calls = _fake(monkeypatch, _docs(5))
    onec.recent_tkp_page(top=50)
    onec.recent_tkp_page(top=50)
    onec.recent_tkp_page(top=50, refresh=True)
    assert len([call for call in calls if call["entity"] == onec._TKP and call["filt"] == onec._POSTED]) == 2
