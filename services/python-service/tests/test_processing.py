import os
from time import perf_counter

import httpx
import pytest
from fastapi.testclient import TestClient

from main import Quote, app, quote

os.environ.setdefault("INTERNAL_SERVICE_TOKEN", "synthetic-test-token-never-used-outside-tests")
client = TestClient(app)
headers = {"x-service-token": os.environ["INTERNAL_SERVICE_TOKEN"]}


def test_authentication():
    assert client.post("/pricing/quote", json={"lines": [{"price": 100, "quantity": 1}]}).status_code == 401


def test_exact_allocation_and_commission():
    result = client.post("/pricing/quote", headers=headers, json={"lines": [{"price": 101, "quantity": 3}, {"price": 202, "quantity": 2}], "promotion": {"discount_bps": 1234, "min_subtotal": 0, "max_discount": 500}})
    assert result.status_code == 200
    data = result.json()
    assert data["subtotal"] == 707
    assert data["discount"] == 87
    assert data["total"] == 620
    assert sum(i["discount"] for i in data["lines"]) == 87
    assert data == result.json()


@pytest.mark.parametrize("line", [{"price": -1, "quantity": 1}, {"price": 1.5, "quantity": 1}, {"price": 100, "quantity": 0}])
def test_invalid_prices(line):
    assert client.post("/pricing/quote", headers=headers, json={"lines": [line]}).status_code == 422


def test_promotion_minimum():
    assert client.post("/pricing/quote", headers=headers, json={"lines": [{"price": 100, "quantity": 1}], "promotion": {"discount_bps": 1000, "min_subtotal": 1000, "max_discount": 100}}).status_code == 422


def test_feed_normalization_duplicates_and_invalid_rows():
    result = client.post("/feeds/validate", headers=headers, json={"csv": "sku,price,name\n abc-1 ,1500,  Linen  Shirt\nABC-1,2000,Duplicate\nBAD,no,Invalid\n"}).json()
    assert result["records"] == [{"sku": "ABC-1", "price": 1500, "name": "Linen Shirt"}]
    assert result["invalid"] == 2


def test_feed_missing_headers():
    assert client.post("/feeds/validate", headers=headers, json={"csv": "name\nhello"}).status_code == 422


def test_cold_start_is_explainable_and_deterministic():
    payload = {"products": [{"id": "a", "category_id": "home", "popularity": 1}, {"id": "b", "category_id": "tech", "popularity": 8}]}
    result = client.post("/recommendations", headers=headers, json=payload).json()
    assert result[0]["id"] == "b"
    assert "no personal history" in result[0]["reason"]
    assert result == client.post("/recommendations", headers=headers, json=payload).json()


def test_personalized_related_recent_and_frequent():
    payload = {"products": [{"id": "a", "category_id": "home"}, {"id": "b", "category_id": "home"}, {"id": "c", "category_id": "tech", "popularity": 99}], "events": [{"product_id": "b", "category_id": "home", "type": "PURCHASE"}, {"product_id": "a", "category_id": "home", "type": "VIEW"}]}
    assert client.post("/recommendations", headers=headers, json=payload).json()[0]["id"] in ["a", "b"]
    assert [i["id"] for i in client.post("/recommendations", headers=headers, json={**payload, "mode": "related", "product_id": "a"}).json()] == ["b"]
    assert client.post("/recommendations", headers=headers, json={**payload, "mode": "recent"}).json()[0]["id"] == "a"
    assert client.post("/recommendations", headers=headers, json={**payload, "mode": "frequent"}).json()[0]["id"] == "b"


@pytest.mark.anyio
async def test_httpx_health():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as session:
        assert (await session.get("/health")).json()["status"] == "ok"


def test_small_correctness_benchmark():
    payload = Quote(lines=[{"price": 1999, "quantity": 2}] * 50, promotion={"discount_bps": 1000, "min_subtotal": 0, "max_discount": 999999})
    started = perf_counter()
    results = [quote(payload) for _ in range(1000)]
    elapsed = perf_counter() - started
    assert all(r["total"] == 179910 for r in results)
    print(f"BENCHMARK: 1000 quotes x 50 lines in {elapsed:.6f}s")
