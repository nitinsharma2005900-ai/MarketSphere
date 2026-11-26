import { Prisma } from "@prisma/client";
import {
  db,
  serial,
  audit,
  lockOrder,
  invalidateCatalog,
  type Tx,
} from "./repository.js";
import { assert, type Actor } from "./http.js";
import { config } from "./config.js";
import { python } from "./python.js";
import { payments, shipping } from "./providers.js";
type Quote = {
  subtotal: number;
  discount: number;
  total: number;
  lines: { discount: number; commission: number }[];
};
export async function checkout(
  actor: Actor,
  addressId: string,
  coupon: string | undefined,
  checkoutKey: string,
) {
  const existing = await db.order.findUnique({
    where: { userId_checkoutKey: { userId: actor.id, checkoutKey } },
    include: { items: true, payment: true },
  });
  if (existing) return existing;
  const cart = await db.cart.findUnique({
    where: { userId: actor.id },
    include: {
      items: {
        include: {
          variant: { include: { product: { include: { seller: true } } } },
        },
      },
    },
  });
  assert(
    cart?.items.length,
    422,
    "EMPTY_CART",
    "Add a product to your cart before checkout",
  );
  const address = await db.address.findFirst({
    where: { id: addressId, userId: actor.id },
  });
  assert(
    address,
    404,
    "ADDRESS_NOT_FOUND",
    "Select one of your saved addresses",
  );
  const promotion = coupon
    ? await db.promotion.findUnique({ where: { code: coupon.toUpperCase() } })
    : null;
  if (coupon)
    assert(
      promotion?.active && promotion.endsAt > new Date(),
      422,
      "INVALID_COUPON",
      "This coupon is invalid or expired",
    );
  const quote = await python<Quote>("/pricing/quote", {
    lines: cart.items.map((i) => ({
      price: i.variant.price,
      quantity: i.quantity,
      commission_bps: i.variant.product.seller.commissionBps,
    })),
    promotion: promotion
      ? {
          discount_bps: promotion.discountBps,
          min_subtotal: promotion.minSubtotal,
          max_discount: promotion.maxDiscount,
        }
      : null,
  });
  const result = await serial(async (tx) => {
    const replay = await tx.order.findUnique({
      where: { userId_checkoutKey: { userId: actor.id, checkoutKey } },
      include: { items: true, payment: true },
    });
    if (replay) return replay;
    const latest = await tx.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { id: "asc" },
    });
    assert(
      latest.length === cart.items.length &&
        latest.every((i) =>
          cart.items.some(
            (c) =>
              c.id === i.id &&
              c.quantity === i.quantity &&
              c.variantId === i.variantId,
          ),
        ),
      409,
      "CART_CHANGED",
      "Your cart changed. Review it and try again",
    );
    if (promotion) {
      const fresh = await tx.promotion.findUniqueOrThrow({
        where: { id: promotion.id },
      });
      assert(
        fresh.active &&
          fresh.endsAt > new Date() &&
          fresh.discountBps === promotion.discountBps &&
          fresh.maxDiscount === promotion.maxDiscount &&
          fresh.minSubtotal === promotion.minSubtotal,
        409,
        "PROMOTION_CHANGED",
        "This promotion changed; review checkout",
      );
      assert(
        !(await tx.promotionUse.findUnique({
          where: {
            promotionId_userId: { promotionId: promotion.id, userId: actor.id },
          },
        })),
        409,
        "COUPON_USED",
        "This coupon has already been used",
      );
    }
    const expiresAt = new Date(Date.now() + config.RESERVATION_SECONDS * 1000);
    const order = await tx.order.create({
      data: {
        userId: actor.id,
        checkoutKey,
        subtotal: quote.subtotal,
        discount: quote.discount,
        total: quote.total,
        address: {
          name: address.name,
          line1: address.line1,
          city: address.city,
          region: address.region,
          postalCode: address.postalCode,
          country: address.country,
        },
        expiresAt,
      },
    });
    // A deterministic lock order and conditional SQL updates prevent check-then-act overselling.
    for (const item of [...cart.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    )) {
      const v = await tx.variant.findUniqueOrThrow({
        where: { id: item.variantId },
        include: { product: { include: { seller: true } } },
      });
      assert(
        v.price === item.variant.price &&
          v.product.seller.commissionBps ===
            item.variant.product.seller.commissionBps,
        409,
        "PRICE_CHANGED",
        "A price changed; review your cart",
      );
      assert(
        v.product.status === "ACTIVE" && v.product.seller.status === "APPROVED",
        409,
        "PRODUCT_UNAVAILABLE",
        "A product is no longer available",
      );
      const inventory = await tx.inventory.findMany({
        where: { variantId: v.id },
        orderBy: { id: "asc" },
      });
      let remaining = item.quantity;
      for (const inv of inventory) {
        if (!remaining) break;
        const qty = Math.min(remaining, inv.onHand - inv.reserved);
        if (qty <= 0) continue;
        const count =
          await tx.$executeRaw`UPDATE "Inventory" SET reserved=reserved+${qty} WHERE id=${inv.id} AND "onHand"-reserved>=${qty}`;
        assert(
          count === 1,
          409,
          "OUT_OF_STOCK",
          "Another customer reserved this stock. Please update your cart",
        );
        await tx.reservation.create({
          data: {
            orderId: order.id,
            inventoryId: inv.id,
            quantity: qty,
            expiresAt,
          },
        });
        await tx.stockMovement.create({
          data: {
            inventoryId: inv.id,
            key: `reserve:${order.id}:${inv.id}`,
            kind: "RESERVE",
            deltaOnHand: 0,
            deltaReserved: qty,
            reason: "Checkout reservation",
          },
        });
        remaining -= qty;
      }
      assert(
        remaining === 0,
        409,
        "OUT_OF_STOCK",
        `${v.product.name} does not have enough available stock`,
      );
      const line = quote.lines[cart.items.findIndex((i) => i.id === item.id)];
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          variantId: v.id,
          sellerId: v.product.sellerId,
          name: v.product.name + " · " + v.name,
          quantity: item.quantity,
          unitPrice: v.price,
          discount: line.discount,
          commission: line.commission,
        },
      });
    }
    if (promotion)
      await tx.promotionUse.create({
        data: {
          promotionId: promotion.id,
          userId: actor.id,
          orderId: order.id,
        },
      });
    await tx.payment.create({
      data: {
        orderId: order.id,
        amount: order.total,
        provider: config.PAYMENT_PROVIDER,
        providerRef: "pending_" + order.id,
      },
    });
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await audit(tx, actor.id, "ORDER_RESERVED", order.id, {
      total: order.total,
    });
    await tx.outbox.create({
      data: {
        key: "expiry:" + order.id,
        type: "RESERVATION_EXPIRY",
        payload: { orderId: order.id, expiresAt: expiresAt.toISOString() },
      },
    });
    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, payment: true },
    });
  });
  await invalidateCatalog();
  return result;
}
export async function paymentIntent(orderId: string) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payment: true },
  });
  assert(
    order.status === "PENDING_PAYMENT" && order.expiresAt > new Date(),
    409,
    "ORDER_NOT_PAYABLE",
    "This order is no longer payable",
  );
  const intent = await payments.intent(order);
  await db.payment.update({
    where: { orderId },
    data: { provider: intent.provider, providerRef: intent.providerRef },
  });
  return intent;
}
async function release(
  tx: Tx,
  orderId: string,
  status: "EXPIRED" | "CANCELLED" | "PAYMENT_FAILED",
) {
  const reservations = await tx.reservation.findMany({
    where: { orderId, status: "ACTIVE" },
    orderBy: { inventoryId: "asc" },
  });
  for (const r of reservations) {
    await tx.inventory.update({
      where: { id: r.inventoryId },
      data: { reserved: { decrement: r.quantity } },
    });
    await tx.stockMovement.create({
      data: {
        inventoryId: r.inventoryId,
        key: `release:${r.id}`,
        kind: "RELEASE",
        deltaOnHand: 0,
        deltaReserved: -r.quantity,
        reason: status,
      },
    });
  }
  await tx.reservation.updateMany({
    where: { orderId, status: "ACTIVE" },
    data: { status: "RELEASED" },
  });
  await tx.order.update({ where: { id: orderId }, data: { status } });
  await tx.promotionUse.deleteMany({ where: { orderId } });
}
export async function expireOrder(orderId: string, forceCancel = false) {
  await serial(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (
      order?.status === "PENDING_PAYMENT" &&
      (forceCancel || order.expiresAt <= new Date())
    ) {
      await release(tx, orderId, forceCancel ? "CANCELLED" : "EXPIRED");
      await audit(tx, undefined, "RESERVATION_RELEASED", orderId);
    }
  });
  await invalidateCatalog();
}
export async function paymentEvent(event: {
  id: string;
  providerRef: string;
  type: "SUCCEEDED" | "FAILED";
  amount: number;
}) {
  const result = await serial(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { providerRef: event.providerRef },
    });
    assert(payment, 404, "PAYMENT_NOT_FOUND", "Payment not found");
    await lockOrder(tx, payment.orderId);
    const seen = await tx.paymentEvent.findUnique({ where: { id: event.id } });
    if (seen) {
      assert(
        seen.paymentId === payment.id,
        409,
        "EVENT_CONFLICT",
        "Event identifier belongs to another payment",
      );
      return { duplicate: true };
    }
    assert(
      payment.amount === event.amount,
      422,
      "AMOUNT_MISMATCH",
      "Payment amount does not match the order",
    );
    const current = await tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId },
    });
    await tx.paymentEvent.create({
      data: { id: event.id, paymentId: payment.id, type: event.type },
    });
    if (
      ["SUCCEEDED", "REFUND_REQUIRED", "LATE_REFUNDED"].includes(current.status)
    )
      return { ignored: true };
    if (event.type === "FAILED") {
      if (order.status === "PENDING_PAYMENT")
        await release(tx, order.id, "PAYMENT_FAILED");
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });
      return { failed: true };
    }
    if (order.status !== "PENDING_PAYMENT" || order.expiresAt <= new Date()) {
      if (order.status === "PENDING_PAYMENT")
        await release(tx, order.id, "EXPIRED");
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "REFUND_REQUIRED" },
      });
      await tx.outbox.upsert({
        where: { key: "late-refund:" + payment.id },
        create: {
          key: "late-refund:" + payment.id,
          type: "LATE_REFUND",
          payload: { paymentId: payment.id },
        },
        update: {},
      });
      return { reconciliationRequired: true };
    }
    const reserved = await tx.reservation.findMany({
      where: { orderId: order.id, status: "ACTIVE" },
      orderBy: { inventoryId: "asc" },
    });
    assert(
      reserved.length,
      409,
      "RESERVATION_MISSING",
      "Payment requires reconciliation",
    );
    for (const r of reserved) {
      const n =
        await tx.$executeRaw`UPDATE "Inventory" SET "onHand"="onHand"-${r.quantity},reserved=reserved-${r.quantity} WHERE id=${r.inventoryId} AND reserved>=${r.quantity} AND "onHand">=${r.quantity}`;
      assert(
        n === 1,
        409,
        "STOCK_INCONSISTENT",
        "Stock requires reconciliation",
      );
      await tx.stockMovement.create({
        data: {
          inventoryId: r.inventoryId,
          key: `sale:${r.id}`,
          kind: "SALE",
          deltaOnHand: -r.quantity,
          deltaReserved: -r.quantity,
          reason: "Confirmed payment",
        },
      });
    }
    await tx.reservation.updateMany({
      where: { orderId: order.id, status: "ACTIVE" },
      data: { status: "CONSUMED" },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCEEDED" },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID" },
    });
    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      include: { variant: true },
    });
    for (const i of items)
      await tx.browseEvent.create({
        data: {
          userId: order.userId,
          productId: i.variant.productId,
          type: "PURCHASE",
        },
      });
    await tx.outbox.create({
      data: {
        key: "email:paid:" + order.id,
        type: "ORDER_EMAIL",
        payload: { orderId: order.id },
      },
    });
    await audit(tx, order.userId, "PAYMENT_CONFIRMED", order.id);
    return { paid: true };
  });
  await invalidateCatalog();
  return result;
}
export async function fulfill(
  actor: Actor,
  orderId: string,
  warehouseId: string,
  items: { orderItemId: string; quantity: number }[],
  key: string,
) {
  assert(
    new Set(items.map((i) => i.orderItemId)).size === items.length,
    422,
    "DUPLICATE_LINE",
    "Each order line may appear only once",
  );
  const result = await serial(async (tx) => {
    await lockOrder(tx, orderId);
    const replay = await tx.shipment.findUnique({ where: { key } });
    if (replay) {
      assert(
        replay.orderId === orderId,
        409,
        "KEY_REUSED",
        "Idempotency key already used",
      );
      return replay;
    }
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    assert(
      ["PAID", "PARTIALLY_FULFILLED"].includes(order.status),
      409,
      "INVALID_TRANSITION",
      "This order cannot be fulfilled",
    );
    const provider = await shipping.create(orderId, key);
    const shipment = await tx.shipment.create({
      data: { orderId, warehouseId, key, ...provider },
    });
    for (const input of items) {
      const item = order.items.find((i) => i.id === input.orderItemId);
      assert(item, 422, "INVALID_LINE", "Order line not found");
      assert(
        actor.role !== "SELLER" || actor.sellerId === item.sellerId,
        403,
        "FORBIDDEN",
        "You may fulfill only your own products",
      );
      assert(
        input.quantity <= item.quantity - item.fulfilled,
        409,
        "OVER_FULFILLMENT",
        "Quantity exceeds the unfulfilled amount",
      );
      const allocated = await tx.reservation.aggregate({
        where: {
          orderId,
          status: "CONSUMED",
          inventory: { warehouseId, variantId: item.variantId },
        },
        _sum: { quantity: true },
      });
      const shipped = await tx.shipmentItem.aggregate({
        where: { orderItemId: item.id, shipment: { warehouseId } },
        _sum: { quantity: true },
      });
      assert(
        (allocated._sum.quantity ?? 0) - (shipped._sum.quantity ?? 0) >=
          input.quantity,
        409,
        "WAREHOUSE_MISMATCH",
        "These units were allocated from another warehouse",
      );
      await tx.shipmentItem.create({
        data: {
          shipmentId: shipment.id,
          orderItemId: item.id,
          quantity: input.quantity,
        },
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { fulfilled: { increment: input.quantity } },
      });
    }
    const latest = await tx.orderItem.findMany({ where: { orderId } });
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: latest.every((i) => i.fulfilled === i.quantity)
          ? "FULFILLED"
          : "PARTIALLY_FULFILLED",
      },
    });
    await audit(tx, actor.id, "SHIPMENT_PREPARED", shipment.id);
    return shipment;
  });
  return result;
}
export async function shippingEvent(event: {
  id: string;
  providerRef: string;
  status: "SHIPPED" | "DELIVERED" | "FAILED";
}) {
  return serial(async (tx) => {
    const ship = await tx.shipment.findUnique({
      where: { providerRef: event.providerRef },
    });
    assert(ship, 404, "SHIPMENT_NOT_FOUND", "Shipment not found");
    await lockOrder(tx, ship.orderId);
    const seen = await tx.shippingEvent.findUnique({ where: { id: event.id } });
    if (seen) {
      assert(
        seen.shipmentId === ship.id,
        409,
        "EVENT_CONFLICT",
        "Event belongs to another shipment",
      );
      return { duplicate: true };
    }
    const current = await tx.shipment.findUniqueOrThrow({
      where: { id: ship.id },
    });
    assert(
      current.status !== "DELIVERED" || event.status === "DELIVERED",
      409,
      "INVALID_TRANSITION",
      "A delivered shipment cannot move backwards",
    );
    await tx.shippingEvent.create({
      data: { id: event.id, shipmentId: ship.id, status: event.status },
    });
    await tx.shipment.update({
      where: { id: ship.id },
      data: { status: event.status },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: ship.orderId },
      include: { items: true, shipments: true },
    });
    if (
      order.items.every((i) => i.fulfilled === i.quantity) &&
      order.shipments.every((s) =>
        s.id === ship.id
          ? event.status === "DELIVERED"
          : s.status === "DELIVERED",
      )
    )
      await tx.order.update({
        where: { id: order.id },
        data: { status: "DELIVERED" },
      });
    await audit(tx, undefined, "SHIPPING_" + event.status, ship.id);
    return { updated: true };
  });
}
export async function requestReturn(
  actor: Actor,
  orderId: string,
  reason: string,
  items: { orderItemId: string; quantity: number }[],
) {
  assert(
    new Set(items.map((i) => i.orderItemId)).size === items.length,
    422,
    "DUPLICATE_LINE",
    "Duplicate return lines",
  );
  return serial(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    assert(order.userId === actor.id, 404, "NOT_FOUND", "Order not found");
    assert(
      order.status === "DELIVERED",
      409,
      "INVALID_TRANSITION",
      "Returns are available after delivery",
    );
    for (const line of items) {
      const item = order.items.find((i) => i.id === line.orderItemId);
      assert(item, 422, "INVALID_LINE", "Invalid return line");
      const past = await tx.returnItem.aggregate({
        where: {
          orderItemId: item.id,
          returnRequest: { status: { not: "REJECTED" } },
        },
        _sum: { quantity: true },
      });
      assert(
        line.quantity + (past._sum.quantity ?? 0) <= item.quantity,
        409,
        "EXCESS_RETURN",
        "Return quantity exceeds purchased quantity",
      );
    }
    const r = await tx.returnRequest.create({
      data: { orderId, reason, items: { create: items } },
    });
    await audit(tx, actor.id, "RETURN_REQUESTED", r.id);
    return r;
  });
}
export async function receiveReturn(actor: Actor, id: string, accept: boolean) {
  return serial(async (tx) => {
    const r = await tx.returnRequest.findUniqueOrThrow({
      where: { id },
      include: { items: { include: { orderItem: true } } },
    });
    await lockOrder(tx, r.orderId);
    const current = await tx.returnRequest.findUniqueOrThrow({ where: { id } });
    if (current.status === (accept ? "RECEIVED" : "REJECTED")) return current;
    assert(
      current.status === "REQUESTED",
      409,
      "INVALID_TRANSITION",
      "Return was already processed",
    );
    if (accept)
      for (const item of r.items) {
        const allocation = await tx.reservation.findFirstOrThrow({
          where: {
            orderId: r.orderId,
            inventory: { variantId: item.orderItem.variantId },
          },
          orderBy: { inventoryId: "asc" },
        });
        await tx.inventory.update({
          where: { id: allocation.inventoryId },
          data: { onHand: { increment: item.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            inventoryId: allocation.inventoryId,
            key: `return:${r.id}:${item.id}`,
            kind: "RETURN",
            deltaOnHand: item.quantity,
            deltaReserved: 0,
            reason: "Return received and inspected",
          },
        });
      }
    await audit(
      tx,
      actor.id,
      accept ? "RETURN_RECEIVED" : "RETURN_REJECTED",
      id,
    );
    return tx.returnRequest.update({
      where: { id },
      data: { status: accept ? "RECEIVED" : "REJECTED" },
    });
  });
}
export async function refundReturn(actor: Actor, returnId: string) {
  const refund = await serial(async (tx) => {
    const r = await tx.returnRequest.findUniqueOrThrow({
      where: { id: returnId },
      include: {
        items: { include: { orderItem: true } },
        order: { include: { payment: true } },
      },
    });
    await lockOrder(tx, r.orderId);
    const prior = await tx.refund.findUnique({ where: { returnId } });
    if (prior) return prior;
    assert(
      r.status === "RECEIVED" && r.order.payment?.status === "SUCCEEDED",
      409,
      "INVALID_TRANSITION",
      "Receive the return before refunding",
    );
    // Cumulative per-line allocation returns exactly the charged amount after the final partial return.
    let amount = 0;
    const reversals = [];
    for (const line of r.items) {
      const item = line.orderItem;
      const previous = await tx.returnItem.aggregate({
        where: {
          orderItemId: item.id,
          returnId: { not: returnId },
          returnRequest: {
            refund: { is: { status: { in: ["PENDING", "SUCCEEDED"] } } },
          },
        },
        _sum: { quantity: true },
      });
      const q = previous._sum.quantity ?? 0;
      const net = item.unitPrice * item.quantity - item.discount;
      const lineRefund =
        Math.floor((net * (q + line.quantity)) / item.quantity) -
        Math.floor((net * q) / item.quantity);
      const commission =
        Math.floor((item.commission * (q + line.quantity)) / item.quantity) -
        Math.floor((item.commission * q) / item.quantity);
      amount += lineRefund;
      reversals.push({
        orderItemId: item.id,
        sellerId: item.sellerId,
        amount: -lineRefund,
        commission: -commission,
      });
    }
    assert(amount >= 0, 409, "REFUND_AMOUNT_INVALID", "Invalid refund amount");
    const total = await tx.refund.aggregate({
      where: {
        paymentId: r.order.payment.id,
        status: { in: ["PENDING", "SUCCEEDED"] },
      },
      _sum: { amount: true },
    });
    assert(
      (total._sum.amount ?? 0) + amount <= r.order.total,
      409,
      "EXCESS_REFUND",
      "Refund exceeds payment",
    );
    const f = await tx.refund.create({
      data: {
        returnId,
        paymentId: r.order.payment.id,
        amount,
        providerRef: "pending_" + returnId,
        financialMovements: { create: reversals },
      },
    });
    await tx.outbox.create({
      data: {
        key: "refund:" + f.id,
        type: "REFUND",
        payload: { refundId: f.id },
      },
    });
    await audit(tx, actor.id, "REFUND_REQUESTED", f.id, { amount });
    return f;
  });
  await processRefund(refund.id);
  return db.refund.findUniqueOrThrow({ where: { id: refund.id } });
}
export async function processRefund(id: string) {
  const f = await db.refund.findUniqueOrThrow({
    where: { id },
    include: { payment: true },
  });
  if (f.status === "SUCCEEDED") return;
  const provider =
    f.amount === 0
      ? { providerRef: "zero_refund_" + f.id, status: "SUCCEEDED" }
      : await payments.refund(
          f.payment.providerRef,
          f.amount,
          "refund_" + f.id,
        );
  await db.refund.update({
    where: { id },
    data: { providerRef: provider.providerRef },
  });
  if (provider.status === "SUCCEEDED")
    await refundEvent("confirmed:" + f.id, provider.providerRef);
}
export async function refundEvent(eventId: string, providerRef: string) {
  const result = await serial(async (tx) => {
    const f = await tx.refund.findUnique({ where: { providerRef } });
    assert(f, 404, "REFUND_NOT_FOUND", "Refund not found");
    const p = await tx.payment.findUniqueOrThrow({
      where: { id: f.paymentId },
    });
    await lockOrder(tx, p.orderId);
    const seen = await tx.refundEvent.findUnique({ where: { id: eventId } });
    if (seen) {
      assert(
        seen.refundId === f.id,
        409,
        "EVENT_CONFLICT",
        "Event belongs to another refund",
      );
      return { duplicate: true };
    }
    await tx.refundEvent.create({ data: { id: eventId, refundId: f.id } });
    if (f.status === "SUCCEEDED") return { ignored: true };
    await tx.refund.update({
      where: { id: f.id },
      data: { status: "SUCCEEDED" },
    });
    await tx.returnRequest.update({
      where: { id: f.returnId },
      data: { status: "REFUNDED" },
    });
    await audit(tx, undefined, "REFUND_CONFIRMED", f.id, { amount: f.amount });
    return { refunded: true };
  });
  await invalidateCatalog();
  return result;
}
export async function reconcileLatePayment(id: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id } });
  if (p.status !== "REFUND_REQUIRED") return;
  const result = await payments.refund(p.providerRef, p.amount, "late_" + p.id);
  assert(
    result.status === "SUCCEEDED",
    503,
    "REFUND_PENDING",
    "Await provider refund confirmation",
  );
  await serial(async (tx) => {
    await lockOrder(tx, p.orderId);
    await tx.payment.updateMany({
      where: { id, status: "REFUND_REQUIRED" },
      data: { status: "LATE_REFUNDED" },
    });
    await audit(tx, undefined, "LATE_PAYMENT_REFUNDED", id, {
      providerRef: result.providerRef,
      amount: p.amount,
    });
  });
}
export async function settle(actor: Actor, sellerId: string, key: string) {
  return serial(async (tx) => {
    const replay = await tx.settlement.findUnique({ where: { key } });
    if (replay) {
      assert(
        replay.sellerId === sellerId,
        409,
        "KEY_REUSED",
        "Key used for another seller",
      );
      return replay;
    }
    const items = await tx.orderItem.findMany({
      where: {
        sellerId,
        order: { status: "DELIVERED" },
        settlementItem: null,
        returnItems: { none: {} },
        orderId: { not: undefined },
      },
    });
    assert(
      items.length,
      409,
      "NOTHING_TO_SETTLE",
      "No eligible delivered items. Returned lines require manual financial review",
    );
    const amounts = items.map((i) => ({
      orderItemId: i.id,
      amount: i.unitPrice * i.quantity - i.discount - i.commission,
    }));
    const s = await tx.settlement.create({
      data: {
        sellerId,
        key,
        amount: amounts.reduce((n, i) => n + i.amount, 0),
        items: { create: amounts },
      },
    });
    await audit(tx, actor.id, "SIMULATED_SETTLEMENT_RECORDED", s.id);
    return s;
  });
}
export const orderInclude = {
  items: {
    include: { variant: { include: { product: { select: { image: true } } } } },
  },
  payment: { include: { refunds: true } },
  shipments: { include: { items: true, events: true } },
  returns: { include: { items: true, refund: true } },
  reservations: {
    include: { inventory: { select: { warehouseId: true, variantId: true } } },
  },
} satisfies Prisma.OrderInclude;
