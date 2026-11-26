"""Stateless, deterministic processing. Express is the owner of all persisted commerce data."""
import csv
import io
import os
import secrets
from collections import Counter
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, model_validator

app = FastAPI(title="MarketSphere Pricing, Feeds & Recommendations", version="1.0.0")


def authorized(x_service_token: str = Header(default="")):
    expected = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
    if not expected or not secrets.compare_digest(x_service_token, expected):
        raise HTTPException(401, "Invalid internal service token")


@app.get("/health")
def health():
    return {"status": "ok", "service": "marketsphere-processing"}


class Line(BaseModel):
    price: int = Field(gt=0, le=100_000_000)
    quantity: int = Field(gt=0, le=100)
    commission_bps: int = Field(default=1000, ge=0, le=5000)


class Promotion(BaseModel):
    discount_bps: int = Field(ge=0, le=5000)
    min_subtotal: int = Field(ge=0)
    max_discount: int = Field(ge=0)


class Quote(BaseModel):
    lines: list[Line] = Field(min_length=1, max_length=100)
    promotion: Promotion | None = None


@app.post("/pricing/quote", dependencies=[Depends(authorized)])
def quote(data: Quote):
    amounts = [line.price * line.quantity for line in data.lines]
    subtotal = sum(amounts)
    if subtotal > 2_000_000_000:
        raise HTTPException(422, "Order exceeds the supported minor-unit total")
    promo = data.promotion
    if promo and subtotal < promo.min_subtotal:
        raise HTTPException(422, "Promotion minimum subtotal not met")
    discount = min(subtotal * promo.discount_bps // 10_000, promo.max_discount) if promo else 0
    # Largest-remainder allocation: sum of per-line discounts exactly matches the order discount.
    allocated = [discount * amount // subtotal for amount in amounts]
    remainder = discount - sum(allocated)
    ranking = sorted(range(len(amounts)), key=lambda i: (-(discount * amounts[i] % subtotal), i))
    for index in ranking[:remainder]:
        allocated[index] += 1
    lines = [
        {"discount": allocated[i], "commission": (amounts[i] - allocated[i]) * line.commission_bps // 10_000}
        for i, line in enumerate(data.lines)
    ]
    return {"subtotal": subtotal, "discount": discount, "total": subtotal - discount, "lines": lines}


class Feed(BaseModel):
    csv: str = Field(min_length=1, max_length=1_000_000)


@app.post("/feeds/validate", dependencies=[Depends(authorized)])
def feed(data: Feed):
    reader = csv.DictReader(io.StringIO(data.csv.lstrip("\ufeff")))
    if not reader.fieldnames or not {"sku", "price"}.issubset(reader.fieldnames):
        raise HTTPException(422, "CSV requires sku,price headers; prices are integer minor units")
    seen, records, errors = set(), [], []
    for number, row in enumerate(reader, 2):
        if number > 5001:
            raise HTTPException(422, "Maximum 5000 rows")
        sku = (row.get("sku") or "").strip().upper()
        raw = (row.get("price") or "").strip()
        if not sku or len(sku) > 100 or not all(c.isascii() and (c.isalnum() or c in "-_") for c in sku):
            errors.append({"row": number, "error": "Invalid SKU"})
        elif sku in seen:
            errors.append({"row": number, "error": "Duplicate normalized SKU", "sku": sku})
        elif not raw.isascii() or not raw.isdigit() or not 0 < int(raw) <= 100_000_000:
            errors.append({"row": number, "error": "Price must be a positive integer in minor units", "sku": sku})
        else:
            records.append({"sku": sku, "price": int(raw), "name": " ".join((row.get("name") or "").split())})
        seen.add(sku)
    return {"records": records, "errors": errors, "valid": len(records), "invalid": len(errors)}


class Product(BaseModel):
    id: str
    category_id: str
    popularity: int = Field(ge=0, default=0)


class Event(BaseModel):
    product_id: str
    category_id: str
    type: Literal["VIEW", "PURCHASE"]


class Recommendations(BaseModel):
    products: list[Product] = Field(max_length=1000)
    events: list[Event] = Field(default_factory=list, max_length=2000)
    mode: Literal["popular", "recent", "related", "category", "frequent", "personalized"] = "personalized"
    product_id: str | None = None
    category_id: str | None = None
    limit: int = Field(default=8, ge=1, le=50)

    @model_validator(mode="after")
    def unique_products(self):
        if len({p.id for p in self.products}) != len(self.products):
            raise ValueError("Product identifiers must be unique")
        return self


@app.post("/recommendations", dependencies=[Depends(authorized)])
def recommendations(data: Recommendations):
    by_id = {p.id: p for p in data.products}
    viewed = list(dict.fromkeys(e.product_id for e in data.events if e.type == "VIEW"))
    bought = Counter(e.product_id for e in data.events if e.type == "PURCHASE")
    affinity = Counter()
    for event in data.events:
        affinity[event.category_id] += 3 if event.type == "PURCHASE" else 1
    related_category = by_id[data.product_id].category_id if data.product_id in by_id else None
    candidates = [p for p in data.products if p.id != data.product_id]
    reason = "Popular across the marketplace; no personal history is needed"
    if data.mode == "recent":
        candidates = [by_id[i] for i in viewed if i in by_id]
        return [{"id": p.id, "reason": "You recently viewed this product"} for p in candidates[:data.limit]]
    if data.mode in ("category", "related"):
        category = data.category_id if data.mode == "category" else related_category
        if category:
            candidates = [p for p in candidates if p.category_id == category]
            reason = "In the same category as your selected product" if data.mode == "related" else "Matches your selected category"
    if data.mode == "frequent" and bought:
        candidates = [p for p in candidates if p.id in bought]
        candidates.sort(key=lambda p: (-bought[p.id], -p.popularity, p.id))
        reason = "Frequently purchased in your synthetic purchase history"
    elif data.mode == "personalized" and affinity:
        candidates.sort(key=lambda p: (-affinity[p.category_id], -p.popularity, p.id))
        return [{"id": p.id, "reason": "Based on your browsing and purchase categories"} for p in candidates[:data.limit]]
    else:
        candidates.sort(key=lambda p: (-p.popularity, p.id))
    return [{"id": p.id, "reason": reason} for p in candidates[:data.limit]]
