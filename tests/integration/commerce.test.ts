import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import sharp from 'sharp';
import jwt from "jsonwebtoken";
import { app } from "../../apps/backend/src/app.js";
import { db, redis } from "../../apps/backend/src/repository.js";
import { config } from "../../apps/backend/src/config.js";
import {
  expireOrder,
  reconcileLatePayment,
} from "../../apps/backend/src/commerce.js";
import { sign, sendEmail } from "../../apps/backend/src/providers.js";
let hash: string;
const prefix = "test-" + randomUUID();
const userFixtures: any[] = [];
const evidence: Record<string, unknown> = {};
const token = (u: any) =>
  jwt.sign({}, config.JWT_ACCESS_SECRET, {
    subject: u.id,
    issuer: "marketsphere",
    audience: "marketsphere-web",
    expiresIn: "15m",
  });
async function user(role: any = "CUSTOMER") {
  const u = await db.user.create({
    data: {
      name: "Synthetic Tester",
      email: randomUUID() + "@marketsphere.test",
      passwordHash: hash,
      role,
      cart: { create: {} },
      ...(role === "SELLER"
        ? { seller: { create: { name: "Test Seller", status: "APPROVED" } } }
        : {}),
    },
    include: { seller: true, cart: true },
  });
  const address = await db.address.create({
    data: {
      userId: u.id,
      name: "Synthetic Tester",
      line1: "1 Test Road",
      city: "Bengaluru",
      region: "KA",
      postalCode: "560001",
    },
  });
  const result = { ...u, token: token(u), address };
  userFixtures.push(result);
  return result;
}
async function product(stock = 3, price = 10000) {
  const seller = await user("SELLER");
  const category = await db.category.upsert({
    where: { slug: prefix },
    create: { name: prefix, slug: prefix },
    update: {},
  });
  const warehouse = await db.warehouse.upsert({
    where: { name: prefix },
    create: { name: prefix, city: "Test City" },
    update: {},
  });
  const p = await db.product.create({
    data: {
      name: "Test product " + randomUUID().slice(0, 5),
      slug: randomUUID(),
      description: "A synthetic product used by the integration tests.",
      image: "/products/product-1.svg",
      sellerId: seller.seller.id,
      categoryId: category.id,
      status: "ACTIVE",
      variants: {
        create: { sku: randomUUID().toUpperCase(), name: "Standard", price },
      },
    },
    include: { variants: true },
  });
  const inventory = await db.inventory.create({
    data: {
      warehouseId: warehouse.id,
      variantId: p.variants[0].id,
      onHand: stock,
    },
  });
  await db.stockMovement.create({
    data: {
      inventoryId: inventory.id,
      key: "open:" + inventory.id,
      kind: "OPENING",
      deltaOnHand: stock,
      deltaReserved: 0,
      reason: "Test fixture",
    },
  });
  return { product: p, variant: p.variants[0], inventory, warehouse, seller };
}
async function reserve(
  c: any,
  p: any,
  quantity = 1,
  coupon?: string,
  key = randomUUID(),
) {
  const cart = await request(app)
    .post("/api/v1/cart/items")
    .set("Authorization", "Bearer " + c.token)
    .send({ variantId: p.variant.id, quantity });
  expect(cart.status).toBe(200);
  return request(app)
    .post("/api/v1/checkout")
    .set("Authorization", "Bearer " + c.token)
    .set("Idempotency-Key", key)
    .send({ addressId: c.address.id, ...(coupon ? { coupon } : {}) });
}
async function intent(c: any, o: any) {
  const r = await request(app)
    .post(`/api/v1/orders/${o.id}/payment-intent`)
    .set("Authorization", "Bearer " + c.token);
  expect(r.status).toBe(200);
  return r.body.data;
}
async function webhook(
  path: string,
  body: unknown,
  secret = config.PAYMENT_WEBHOOK_SECRET,
) {
  const raw = JSON.stringify(body);
  return request(app)
    .post("/api/v1/webhooks/" + path)
    .set("Content-Type", "application/json")
    .set("X-Webhook-Signature", sign(raw, secret))
    .send(raw);
}
async function paidOrder(quantity = 2) {
  const c = await user(),
    p = await product(5),
    r = await reserve(c, p, quantity);
  expect(r.status).toBe(201);
  const o = r.body.data,
    pi = await intent(c, o);
  expect(
    (
      await webhook("payments", {
        id: randomUUID(),
        providerRef: pi.providerRef,
        amount: o.total,
        type: "SUCCEEDED",
      })
    ).status,
  ).toBe(200);
  return { c, p, o, pi };
}
beforeAll(async () => {
  if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
    throw new Error("Integration tests require a dedicated _test database");
  hash = await bcrypt.hash("SyntheticPassword!2026", 4);
});
afterAll(async () => {
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(
    "docs/evidence/capstone.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        database: "PostgreSQL",
        ...evidence,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
  redis.disconnect();
});
describe("authentication and authorization", () => {
  it("rejects invalid registration and role escalation", async () => {
    expect(
      (
        await request(app)
          .post("/api/v1/auth/register")
          .send({ name: "x", email: "bad", password: "x", role: "ADMIN" })
      ).status,
    ).toBe(422);
  });
  it("registers a seller as pending and protects publishing", async () => {
    const r = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Pending Studio",
        email: randomUUID() + "@marketsphere.test",
        password: "SyntheticPassword!2026",
        role: "SELLER",
      });
    expect(r.status).toBe(201);
    const s = await db.seller.findUnique({
      where: { userId: r.body.data.user.id },
    });
    expect(s?.status).toBe("PENDING");
  });
  it("authenticates, rotates refresh token, and revokes a reused family", async () => {
    const c = await user();
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: c.email, password: "SyntheticPassword!2026" });
    expect(login.status).toBe(200);
    expect(login.body.data.user.passwordHash).toBeUndefined();
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const next = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.FRONTEND_URL)
      .set("Cookie", cookie);
    expect(next.status).toBe(200);
    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.FRONTEND_URL)
      .set("Cookie", cookie);
    expect(replay.status).toBe(401);
    const rotated = next.headers["set-cookie"][0].split(";")[0];
    expect(
      (
        await request(app)
          .post("/api/v1/auth/refresh")
          .set("Origin", config.FRONTEND_URL)
          .set("Cookie", rotated)
      ).status,
    ).toBe(401);
  });
  it("rejects invalid login, tokens, CSRF origin, and unauthenticated orders", async () => {
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "missing@marketsphere.test", password: "x" })
      ).status,
    ).toBe(401);
    expect((await request(app).get("/api/v1/orders")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/v1/orders")
          .set("Authorization", "Bearer forged")
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/refresh")
          .set("Origin", "https://malicious.example")
      ).status,
    ).toBe(403);
  });
  it("enforces cross-seller product and inventory isolation", async () => {
    const p = await product(),
      other = await user("SELLER");
    expect(
      (
        await request(app)
          .patch("/api/v1/seller/products/" + p.product.id)
          .set("Authorization", "Bearer " + other.token)
          .send({ name: "Hijacked product" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/v1/inventory/adjust")
          .set("Authorization", "Bearer " + other.token)
          .set("Idempotency-Key", randomUUID())
          .send({
            variantId: p.variant.id,
            warehouseId: p.warehouse.id,
            delta: 10,
            reason: "Invalid cross-seller attempt",
          })
      ).status,
    ).toBe(404);
    const list = await request(app)
      .get("/api/v1/seller/products")
      .set("Authorization", "Bearer " + other.token);
    expect(list.body.data).toEqual([]);
  });
  it("protects customer order privacy and admin permissions", async () => {
    const { c, o } = await paidOrder(),
      other = await user();
    expect(
      (
        await request(app)
          .get("/api/v1/orders/" + o.id)
          .set("Authorization", "Bearer " + other.token)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/api/v1/admin/users")
          .set("Authorization", "Bearer " + c.token)
      ).status,
    ).toBe(403);
  });
  it("rejects executable file uploads and spoofed MIME bytes", async () => {
    const s = await user("SELLER");
    expect(
      (
        await request(app)
          .post("/api/v1/uploads")
          .set("Authorization", "Bearer " + s.token)
          .attach("image", Buffer.from('<svg onload="alert(1)"></svg>'), {
            filename: "evil.svg",
            contentType: "image/svg+xml",
          })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post("/api/v1/uploads")
          .set("Authorization", "Bearer " + s.token)
          .attach("image", Buffer.from("not png"), {
            filename: "fake.png",
            contentType: "image/png",
          })
      ).status,
    ).toBe(422);
  });
});
describe("catalog, carts and discounts", () => {
  it("creates a product for moderation and allows the owning seller to edit", async () => {
    const p = await product();
    const body = {
      name: "New Product",
      description: "Valid synthetic description",
      categoryId: p.product.categoryId,
      image: "/products/product-1.svg",
      variants: [{ sku: randomUUID(), name: "Standard", price: 10000 }],
    };
    const r = await request(app)
      .post("/api/v1/seller/products")
      .set("Authorization", "Bearer " + p.seller.token)
      .send(body);
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe("PENDING");
    expect(
      (await request(app).get("/api/v1/products/" + r.body.data.id)).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch("/api/v1/seller/products/" + r.body.data.id)
          .set("Authorization", "Bearer " + p.seller.token)
          .send({ name: "Updated Product" })
      ).status,
    ).toBe(200);
  });
  it("does not reserve stock for an abandoned cart and rejects invalid quantities", async () => {
    const c = await user(),
      p = await product(1);
    expect(
      (
        await request(app)
          .post("/api/v1/cart/items")
          .set("Authorization", "Bearer " + c.token)
          .send({ variantId: p.variant.id, quantity: -1 })
      ).status,
    ).toBe(422);
    await request(app)
      .post("/api/v1/cart/items")
      .set("Authorization", "Bearer " + c.token)
      .send({ variantId: p.variant.id, quantity: 1 });
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { id: p.inventory.id } }))
        .reserved,
    ).toBe(0);
  });
  it("validates empty carts, addresses, idempotency keys and malicious search", async () => {
    const c = await user();
    expect(
      (
        await request(app)
          .post("/api/v1/checkout")
          .set("Authorization", "Bearer " + c.token)
          .set("Idempotency-Key", "short")
          .send({ addressId: c.address.id })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post("/api/v1/checkout")
          .set("Authorization", "Bearer " + c.token)
          .set("Idempotency-Key", randomUUID())
          .send({ addressId: c.address.id })
      ).status,
    ).toBe(422);
    const search = await request(app)
      .get("/api/v1/products")
      .query({ search: "'; DROP TABLE users; --" });
    expect(search.status).toBe(200);
    expect(Array.isArray(search.body.data)).toBe(true);
  });
  it("applies an integer discount once and prevents coupon reuse", async () => {
    const c = await user(),
      p = await product(5, 1999);
    const promo = await db.promotion.create({
      data: {
        code: randomUUID().replaceAll("-", "").toUpperCase(),
        discountBps: 1000,
        minSubtotal: 0,
        maxDiscount: 5000,
        endsAt: new Date(Date.now() + 86400000),
      },
    });
    const r = await reserve(c, p, 2, promo.code);
    expect(r.status).toBe(201);
    expect(r.body.data.discount).toBe(399);
    expect(r.body.data.total).toBe(3599);
    const pi = await intent(c, r.body.data);
    await webhook("payments", {
      id: randomUUID(),
      providerRef: pi.providerRef,
      type: "SUCCEEDED",
      amount: r.body.data.total,
    });
    expect((await reserve(c, p, 1, promo.code)).status).toBe(409);
  });
  it("atomically rejects imports containing another seller’s SKU", async () => {
    const p = await product(),
      other = await product();
    const r = await request(app)
      .post("/api/v1/seller/import")
      .set("Authorization", "Bearer " + p.seller.token)
      .send({
        csv: `sku,price\n${p.variant.sku},20000\n${other.variant.sku},30000`,
        apply: true,
      });
    expect(r.status).toBe(403);
    expect(
      (await db.variant.findUniqueOrThrow({ where: { id: p.variant.id } }))
        .price,
    ).toBe(10000);
  });
});
describe("inventory capstone and failure paths", () => {
  it("two independent sessions concurrently buy the last unit: exactly one reserves it", async () => {
    const p = await product(1),
      a = await user(),
      b = await user();
    // Authenticate independently through the real login API, rather than sharing a session token.
    for (const c of [a, b]) {
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: c.email, password: "SyntheticPassword!2026" });
      expect(login.status).toBe(200);
      c.token = login.body.data.accessToken;
      await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", "Bearer " + c.token)
        .send({ variantId: p.variant.id, quantity: 1 });
    }
    const reserveCall = (c: any) =>
      request(app)
        .post("/api/v1/checkout")
        .set("Authorization", "Bearer " + c.token)
        .set("Idempotency-Key", randomUUID())
        .send({ addressId: c.address.id });
    const results = await Promise.all([reserveCall(a), reserveCall(b)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const inv = await db.inventory.findUniqueOrThrow({
      where: { id: p.inventory.id },
    });
    expect(inv.onHand).toBe(1);
    expect(inv.reserved).toBe(1);
    const reservations = await db.reservation.findMany({
      where: { inventoryId: inv.id, status: "ACTIVE" },
    });
    expect(reservations).toHaveLength(1);
    const ledger = await db.stockMovement.findMany({
      where: { inventoryId: inv.id },
    });
    expect(ledger.reduce((n, i) => n + i.deltaReserved, 0)).toBe(inv.reserved);
    expect(ledger.reduce((n, i) => n + i.deltaOnHand, 0)).toBe(inv.onHand);
    evidence.concurrentLastItem = {
      statuses: results.map((r) => r.status),
      losingError: results.find((r) => r.status === 409)?.body.error.code,
      onHand: inv.onHand,
      reserved: inv.reserved,
      activeReservations: reservations.length,
      ledgerEntries: ledger.length,
      independentAuthenticatedSessions: 2,
    };
  });
  it("releases expired stock exactly once and keeps the ledger consistent", async () => {
    const c = await user(),
      p = await product(1),
      r = await reserve(c, p);
    await db.order.update({
      where: { id: r.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await Promise.all([
      expireOrder(r.body.data.id),
      expireOrder(r.body.data.id),
    ]);
    const inv = await db.inventory.findUniqueOrThrow({
      where: { id: p.inventory.id },
    });
    expect(inv.reserved).toBe(0);
    expect(inv.onHand).toBe(1);
    expect(
      await db.stockMovement.count({
        where: { inventoryId: inv.id, kind: "RELEASE" },
      }),
    ).toBe(1);
  });
  it("prevents negative inventory and ledger mutation at database level", async () => {
    const p = await product(1);
    await expect(
      db.inventory.update({
        where: { id: p.inventory.id },
        data: { onHand: -1 },
      }),
    ).rejects.toThrow();
    await expect(
      db.stockMovement.updateMany({
        where: { inventoryId: p.inventory.id },
        data: { deltaOnHand: 100 },
      }),
    ).rejects.toThrow();
  });
  it("replays checkout idempotently without a second order or reservation", async () => {
    const c = await user(),
      p = await product(4),
      key = randomUUID();
    const a = await reserve(c, p, 1, undefined, key);
    const b = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", "Bearer " + c.token)
      .set("Idempotency-Key", key)
      .send({ addressId: c.address.id });
    expect(a.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { id: p.inventory.id } }))
        .reserved,
    ).toBe(1);
  });
  it("deduplicates signed payment events and stock consumption", async () => {
    const c = await user(),
      p = await product(3),
      r = await reserve(c, p),
      o = r.body.data,
      pi = await intent(c, o);
    const event = {
      id: randomUUID(),
      providerRef: pi.providerRef,
      type: "SUCCEEDED",
      amount: o.total,
    };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => webhook("payments", event)),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await db.paymentEvent.count({ where: { id: event.id } })).toBe(1);
    expect(await db.order.count({ where: { id: o.id } })).toBe(1);
    expect(
      await db.stockMovement.count({
        where: { inventoryId: p.inventory.id, kind: "SALE" },
      }),
    ).toBe(1);
    const inv = await db.inventory.findUniqueOrThrow({
      where: { id: p.inventory.id },
    });
    expect(inv.onHand).toBe(2);
    expect(inv.reserved).toBe(0);
    evidence.duplicatePayment = {
      replays: 5,
      statuses: responses.map((r) => r.status),
      paymentEvents: 1,
      orders: 1,
      saleMovements: 1,
      onHand: inv.onHand,
      reserved: inv.reserved,
    };
  });
  it("rejects invalid signatures and payment amount mismatches", async () => {
    expect(
      (
        await request(app)
          .post("/api/v1/webhooks/payments")
          .set("Content-Type", "application/json")
          .set("X-Webhook-Signature", "bad")
          .send("{}")
      ).status,
    ).toBe(401);
    const c = await user(),
      p = await product(),
      r = await reserve(c, p),
      pi = await intent(c, r.body.data);
    expect(
      (
        await webhook("payments", {
          id: randomUUID(),
          providerRef: pi.providerRef,
          type: "SUCCEEDED",
          amount: 1,
        })
      ).status,
    ).toBe(422);
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: r.body.data.id } }))
        .status,
    ).toBe("PENDING_PAYMENT");
  });
  it("releases stock on failure and reconciles late success without overselling", async () => {
    const c = await user(),
      p = await product(1),
      r = await reserve(c, p),
      o = r.body.data,
      pi = await intent(c, o);
    expect(
      (
        await webhook("payments", {
          id: randomUUID(),
          providerRef: pi.providerRef,
          type: "FAILED",
          amount: o.total,
        })
      ).status,
    ).toBe(200);
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { id: p.inventory.id } }))
        .reserved,
    ).toBe(0);
    const late = await webhook("payments", {
      id: randomUUID(),
      providerRef: pi.providerRef,
      type: "SUCCEEDED",
      amount: o.total,
    });
    expect(late.body.data.reconciliationRequired).toBe(true);
    const payment = await db.payment.findUniqueOrThrow({
      where: { orderId: o.id },
    });
    await reconcileLatePayment(payment.id);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .status,
    ).toBe("LATE_REFUNDED");
    expect(
      await db.stockMovement.count({
        where: { inventoryId: p.inventory.id, kind: "SALE" },
      }),
    ).toBe(0);
  });
});
describe("partial fulfillment, callbacks, returns and refunds", () => {
  it("enforces partial fulfillment quantities and recovers a failed shipping callback", async () => {
    const { c, p, o } = await paidOrder(2),
      admin = await user("ADMIN");
    const ship = async (q: number) =>
      request(app)
        .post("/api/v1/orders/" + o.id + "/shipments")
        .set("Authorization", "Bearer " + admin.token)
        .set("Idempotency-Key", randomUUID())
        .send({
          warehouseId: p.warehouse.id,
          items: [{ orderItemId: o.items[0].id, quantity: q }],
        });
    const first = await ship(1);
    expect(first.status).toBe(201);
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe("PARTIALLY_FULFILLED");
    expect((await ship(2)).status).toBe(409);
    const e = {
      id: randomUUID(),
      providerRef: first.body.data.providerRef,
      status: "FAILED",
    };
    expect(
      (await webhook("shipping", e, config.SHIPPING_WEBHOOK_SECRET)).status,
    ).toBe(200);
    expect(
      (await webhook("shipping", e, config.SHIPPING_WEBHOOK_SECRET)).body.data
        .duplicate,
    ).toBe(true);
    expect(
      (
        await webhook(
          "shipping",
          { ...e, id: randomUUID(), status: "DELIVERED" },
          config.SHIPPING_WEBHOOK_SECRET,
        )
      ).status,
    ).toBe(200);
    const second = await ship(1);
    await webhook(
      "shipping",
      {
        id: randomUUID(),
        providerRef: second.body.data.providerRef,
        status: "DELIVERED",
      },
      config.SHIPPING_WEBHOOK_SECRET,
    );
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe("DELIVERED");
    expect(
      (
        await request(app)
          .get("/api/v1/orders/" + o.id)
          .set("Authorization", "Bearer " + c.token)
      ).status,
    ).toBe(200);
  });
  it("refunds a received partial return once despite concurrent replays", async () => {
    const { c, p, o } = await paidOrder(2),
      admin = await user("ADMIN");
    const shipment = await request(app)
      .post("/api/v1/orders/" + o.id + "/shipments")
      .set("Authorization", "Bearer " + admin.token)
      .set("Idempotency-Key", randomUUID())
      .send({
        warehouseId: p.warehouse.id,
        items: [{ orderItemId: o.items[0].id, quantity: 2 }],
      });
    await webhook(
      "shipping",
      {
        id: randomUUID(),
        providerRef: shipment.body.data.providerRef,
        status: "DELIVERED",
      },
      config.SHIPPING_WEBHOOK_SECRET,
    );
    const ret = await request(app)
      .post("/api/v1/orders/" + o.id + "/returns")
      .set("Authorization", "Bearer " + c.token)
      .send({
        reason: "Synthetic item not suitable",
        items: [{ orderItemId: o.items[0].id, quantity: 1 }],
      });
    expect(ret.status).toBe(201);
    const id = ret.body.data.id;
    expect(
      (
        await request(app)
          .post("/api/v1/returns/" + id + "/refund")
          .set("Authorization", "Bearer " + admin.token)
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post("/api/v1/returns/" + id + "/receive")
          .set("Authorization", "Bearer " + admin.token)
          .send({ accept: true })
      ).status,
    ).toBe(200);
    const refund = await request(app)
      .post("/api/v1/returns/" + id + "/refund")
      .set("Authorization", "Bearer " + admin.token);
    expect(refund.status).toBe(200);
    expect(refund.body.data.amount).toBe(10000);
    const eventId = randomUUID();
    const replays = await Promise.all(
      Array.from({ length: 5 }, () =>
        webhook("refunds", {
          id: eventId,
          providerRef: refund.body.data.providerRef,
        }),
      ),
    );
    expect(replays.every((r) => r.status === 200)).toBe(true);
    const again = await request(app)
      .post("/api/v1/returns/" + id + "/refund")
      .set("Authorization", "Bearer " + admin.token);
    expect(again.body.data.id).toBe(refund.body.data.id);
    expect(await db.refund.count({ where: { returnId: id } })).toBe(1);
    expect(
      await db.financialMovement.count({
        where: { refundId: refund.body.data.id },
      }),
    ).toBe(1);
    expect(
      (
        await db.financialMovement.findFirstOrThrow({
          where: { refundId: refund.body.data.id },
        })
      ).commission,
    ).toBe(-1000);
    expect(
      await db.stockMovement.count({
        where: { inventoryId: p.inventory.id, kind: "RETURN" },
      }),
    ).toBe(1);
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { id: p.inventory.id } }))
        .onHand,
    ).toBe(4);
    evidence.duplicateRefund = {
      replays: 5,
      statuses: replays.map((r) => r.status),
      refundRecords: 1,
      refundAmount: refund.body.data.amount,
      restockMovements: 1,
      financialReversals: 1,
    };
    expect(
      (
        await request(app)
          .post("/api/v1/orders/" + o.id + "/returns")
          .set("Authorization", "Bearer " + c.token)
          .send({
            reason: "Attempt to return too many units",
            items: [{ orderItemId: o.items[0].id, quantity: 2 }],
          })
      ).status,
    ).toBe(409);
  });
  it("returns a safe explainable recommendation fallback", async () => {
    await product();
    const r = await request(app).get("/api/v1/recommendations");
    expect(r.status).toBe(200);
    expect(r.body.data[0].reason).toContain("no personal history");
  });
  it("runs indexed search and captures the actual PostgreSQL plan", async () => {
    const plan =
      await db.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM "Product" WHERE status='ACTIVE' AND name ILIKE '%Test%' LIMIT 24`;
    evidence.searchPlan = plan;
    const indices = await db.$queryRaw<
      any[]
    >`SELECT indexname FROM pg_indexes WHERE tablename='Product' AND indexname='product_name_search_idx'`;
    expect(indices).toHaveLength(1);
    expect(
      (await request(app).get("/api/v1/products?search=Test&limit=2")).body.data
        .length,
    ).toBeLessThanOrEqual(2);
  });
});
describe("local integration adapters and catalog consistency", () => {
  it.skipIf(!process.env.S3_ENDPOINT)(
    "uploads and retrieves a sanitized image from real local MinIO",
    async () => {
      const seller = await user("SELLER");
    const png = await sharp({create:{width:8,height:8,channels:3,background:{r:40,g:80,b:100}}}).png().toBuffer();
      const r = await request(app)
        .post("/api/v1/uploads")
        .set("Authorization", "Bearer " + seller.token)
        .attach("image", png, {
          filename: "safe.png",
          contentType: "image/png",
        });
      expect(r.status).toBe(201);
      const downloaded = await fetch(r.body.data.url);
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get("content-type")).toBe("image/webp");
    },
  );
  it.skipIf(!process.env.SMTP_HOST)(
    "captures a synthetic email in Mailpit without external delivery",
    async () => {
      const subject = "Synthetic integration " + randomUUID();
      const result = await sendEmail(
        "synthetic@marketsphere.test",
        subject,
        "Local sandbox capture only.",
      );
      expect(result.accepted).toContain("synthetic@marketsphere.test");
      const mail = await fetch("http://localhost:8025/api/v1/messages");
      expect(mail.ok).toBe(true);
      const data = (await mail.json()) as any;
      expect(data.messages.some((m: any) => m.Subject === subject)).toBe(true);
    },
  );
  it("imports an own price CSV and invalidates cached catalog stock after adjustment", async () => {
    const p = await product(2),
      admin = await user("ADMIN");
    const csv = `sku,price\n${p.variant.sku},15000`;
    expect(
      (
        await request(app)
          .post("/api/v1/seller/import")
          .set("Authorization", "Bearer " + p.seller.token)
          .send({ csv, apply: true })
      ).status,
    ).toBe(200);
    expect(
      (await db.variant.findUniqueOrThrow({ where: { id: p.variant.id } }))
        .price,
    ).toBe(15000);
    const url = "/api/v1/products?search=" + encodeURIComponent(p.product.name);
    await request(app).get(url);
    const cached = await request(app).get(url);
    expect(cached.headers["x-catalog-cache"]).toBe("HIT");
    expect(
      (
        await request(app)
          .post("/api/v1/inventory/adjust")
          .set("Authorization", "Bearer " + admin.token)
          .set("Idempotency-Key", randomUUID())
          .send({
            variantId: p.variant.id,
            warehouseId: p.warehouse.id,
            delta: 3,
            reason: "Synthetic incoming inventory",
          })
      ).status,
    ).toBe(200);
    const fresh = await request(app).get(url);
    expect(fresh.headers["x-catalog-cache"]).toBe("MISS");
    expect(fresh.body.data[0].variants[0].inventory[0].onHand).toBe(5);
  });
  it("imports a product catalog feed into pending moderation", async () => {
    const p = await product();
    const sku = "FEED-" + randomUUID().toUpperCase();
    const csv = `sku,price,name,description,category_slug\n${sku},1999,New Feed Mug,Synthetic handcrafted ceramic mug,${prefix}`;
    const r = await request(app)
      .post("/api/v1/seller/catalog-import")
      .set("Authorization", "Bearer " + p.seller.token)
      .send({ csv, apply: true });
    expect(r.status).toBe(200);
    const v = await db.variant.findUniqueOrThrow({
      where: { sku },
      include: { product: true },
    });
    expect(v.product.status).toBe("PENDING");
    expect(v.product.sellerId).toBe(p.seller.seller.id);
  });
});
