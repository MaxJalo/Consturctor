from __future__ import annotations

from app.services.external_order_onec import OnecLinkError, recent_tkp


def _docs(count: int) -> list[dict]:
    return [
        {
            "Ref_Key": f"{index:08d}-0000-0000-0000-000000000000",
            "Number": str(index),
            "Date": "2026-01-02T10:00:00",
        }
        for index in range(count)
    ]


def test_recent_tkp_reads_past_the_first_page(monkeypatch) -> None:
    docs = _docs(230)
    calls: list[tuple[int, int]] = []

    def fake_rows(client, entity, *, filt="", top=20, ref_key="", orderby="", skip=0, select=""):
        _ = (client, entity, filt, ref_key, orderby, select)
        calls.append((skip, top))
        return docs[skip : skip + top]

    monkeypatch.setattr("app.services.external_order_onec._client", lambda: object())
    monkeypatch.setattr("app.services.external_order_onec._rows", fake_rows)
    monkeypatch.setattr("app.services.external_order_onec._titles", lambda *args, **kwargs: {})

    result = recent_tkp()

    assert [item["number"] for item in result["orders"]] == [str(index) for index in range(230)]
    assert calls[:2] == [(0, 200), (200, 200)]
    assert calls[2:] and all(top <= 20 for _skip, top in calls[2:])


def test_recent_tkp_stops_when_the_page_repeats(monkeypatch) -> None:
    page = _docs(200)

    def fake_rows(client, entity, *, filt="", top=20, ref_key="", orderby="", skip=0, select=""):
        _ = (client, entity, filt, top, ref_key, orderby, skip, select)
        return page

    monkeypatch.setattr("app.services.external_order_onec._client", lambda: object())
    monkeypatch.setattr("app.services.external_order_onec._rows", fake_rows)
    monkeypatch.setattr("app.services.external_order_onec._titles", lambda *args, **kwargs: {})

    result = recent_tkp()

    assert len(result["orders"]) == 200


def test_recent_tkp_drops_select_when_odata_rejects_it(monkeypatch) -> None:
    seen: list[str] = []

    def fake_rows(client, entity, *, filt="", top=20, ref_key="", orderby="", skip=0, select=""):
        _ = (client, entity, filt, top, ref_key, orderby, skip)
        seen.append(select)
        if select:
            raise OnecLinkError("поле не найдено", 502)
        return _docs(3)

    monkeypatch.setattr("app.services.external_order_onec._client", lambda: object())
    monkeypatch.setattr("app.services.external_order_onec._rows", fake_rows)
    monkeypatch.setattr("app.services.external_order_onec._titles", lambda *args, **kwargs: {})

    result = recent_tkp()

    assert len(result["orders"]) == 3
    assert seen[0]
    assert seen[1] == ""
