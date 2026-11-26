import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type Role } from "@prisma/client";
import multer from "multer";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import {
  db,
  redis,
  serial,
  audit,
  invalidateCatalog,
  catalogVersionKey,
} from "./repository.js";
import {
  authenticate,
  roles,
  assert,
  pageSchema,
  key,
  ownOrder,
  ApiError,
} from "./http.js";
import {
  checkout,
  expireOrder,
  paymentIntent,
  paymentEvent,
  fulfill,
  shippingEvent,
  requestReturn,
  receiveReturn,
  refundReturn,
  settle,
  orderInclude,
} from "./commerce.js";
import { config } from "./config.js";
import { python } from "./python.js";
import { uploadImage } from "./providers.js";
export const api = Router();
export const contracts: {
  method: string;
  path: string;
  summary: string;
  roles: Role[];
  authenticated?: boolean;
  schema?: z.ZodType;
}[] = [];
function route(
  method: "get" | "post" | "patch" | "delete",
  path: string,
  summary: string,
  allowed: Role[] | null,
  schema: z.ZodType | undefined,
  handler: (req: Request, res: Response) => Promise<unknown>,
) {
  contracts.push({
    method,
    path,
    summary,
    roles: allowed ?? [],
    authenticated: allowed !== null,
    schema,
  });
  api[method](
    path,
    ...(allowed
      ? [authenticate, ...(allowed.length ? [roles(allowed)] : [])]
      : []),
    async (req, res) => {
      if (schema) req.body = schema.parse(req.body);
      await handler(req, res);
    },
  );
}
const staff: Role[] = ["ADMIN", "SUPPORT"];
const positive = z.number().int().min(1).max(100000000);
const qty = z.number().int().min(1).max(100);
const id = z.string().min(1).max(100);
const str = z.string().trim().min(2).max(200);
const p = (req: Request, name = "id") => String(req.params[name]);
const send = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ data });
const productInclude = {
  category: true,
  seller: { select: { id: true, name: true, status: true } },
  variants: {
    include: {
      inventory: {
        select: { warehouseId: true, onHand: true, reserved: true },
      },
    },
  },
  reviews: { select: { rating: true } },
} satisfies Prisma.ProductInclude;
const productSchema = z.object({
  name: str,
  description: z.string().min(10).max(5000),
  categoryId: id,
  image: z
    .string()
    .max(1000)
    .refine(
      (s) =>
        s.startsWith("/products/") ||
        s.startsWith("http://localhost:9040/") ||
        s.startsWith("https://"),
      "Use a local image or HTTPS URL",
    ),
  variants: z
    .array(
      z.object({
        sku: z
          .string()
          .min(3)
          .max(100)
          .regex(/^[A-Za-z0-9_-]+$/)
          .transform((s) => s.toUpperCase()),
        name: str,
        price: positive,
        attributes: z.record(z.string(), z.string()).default({}),
      }),
    )
    .min(1)
    .max(30),
});
route(
  "get",
  "/categories",
  "List categories",
  null,
  undefined,
  async (_req, res) => {
    send(res, await db.category.findMany({ orderBy: { name: "asc" } }));
  },
);
route(
  "get",
  "/products",
  "Search approved products with pagination and category, seller, price and sort filters",
  null,
  undefined,
  async (req, res) => {
    const { page, limit } = pageSchema.parse(req.query);
    const q = z
      .object({
        search: z.string().max(120).optional(),
        category: z.string().max(100).optional(),
        seller: z.string().max(100).optional(),
        min: z.coerce.number().min(0).optional(),
        max: z.coerce.number().min(0).optional(),
        sort: z
          .enum(["newest", "price-asc", "price-desc", "name"])
          .default("newest"),
      })
      .parse(req.query);
    const where: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      seller: { status: "APPROVED" },
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { description: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.seller ? { sellerId: q.seller } : {}),
      ...(q.min !== undefined || q.max !== undefined
        ? { variants: { some: { price: { gte: q.min, lte: q.max } } } }
        : {}),
    };
    const version = await redis.get(catalogVersionKey).catch(() => null);
    const cacheKey =
      catalogVersionKey +
      ":" +
      (version ?? "0") +
      ":" +
      createHash("sha256")
        .update(JSON.stringify({ page, limit, ...q }))
        .digest("hex");
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      res.setHeader("X-Catalog-Cache", "HIT");
      return res.json(JSON.parse(cached));
    }
    let data;
    if (q.sort.startsWith("price")) {
      const conditions = [
        Prisma.sql`p.status='ACTIVE' AND s.status='APPROVED'`,
      ];
      if (q.search)
        conditions.push(
          Prisma.sql`(p.name ILIKE ${"%" + q.search + "%"} OR p.description ILIKE ${"%" + q.search + "%"})`,
        );
      if (q.category) conditions.push(Prisma.sql`c.slug=${q.category}`);
      if (q.seller) conditions.push(Prisma.sql`p."sellerId"=${q.seller}`);
      if (q.min !== undefined || q.max !== undefined)
        conditions.push(
          Prisma.sql`EXISTS (SELECT 1 FROM "Variant" f WHERE f."productId"=p.id AND f.price>=${q.min ?? 0} AND f.price<=${q.max ?? 2147483647})`,
        );
      const ids = await db.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT p.id FROM "Product" p JOIN "Seller" s ON s.id=p."sellerId" JOIN "Category" c ON c.id=p."categoryId" JOIN "Variant" v ON v."productId"=p.id WHERE ${Prisma.join(conditions, " AND ")} GROUP BY p.id ORDER BY MIN(v.price) ${q.sort === "price-asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`},p.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      );
      const products = await db.product.findMany({
        where: { id: { in: ids.map((i) => i.id) } },
        include: productInclude,
      });
      data = ids.map((i) => products.find((p) => p.id === i.id)!);
    } else
      data = await db.product.findMany({
        where,
        include: productInclude,
        orderBy:
          q.sort === "name"
            ? [{ name: "asc" }, { id: "asc" }]
            : [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      });
    const total = await db.product.count({ where });
    const result = {
      data,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
    await redis
      .set(cacheKey, JSON.stringify(result), "EX", 15)
      .catch(() => undefined);
    res.setHeader("X-Catalog-Cache", "MISS");
    res.json(result);
  },
);
route(
  "get",
  "/products/:id",
  "Get an approved product, variants, stock and reviews",
  null,
  undefined,
  async (req, res) => {
    const product = await db.product.findFirst({
      where: {
        OR: [{ id: p(req) }, { slug: p(req) }],
        status: "ACTIVE",
        seller: { status: "APPROVED" },
      },
      include: {
        ...productInclude,
        reviews: { include: { user: { select: { name: true } } } },
      },
    });
    assert(product, 404, "NOT_FOUND", "Product not found");
    send(res, product);
  },
);
route(
  "post",
  "/events",
  "Record a browsing event",
  ["CUSTOMER"],
  z.object({ productId: id }),
  async (req, res) => {
    assert(
      await db.product.findFirst({
        where: { id: req.body.productId, status: "ACTIVE" },
      }),
      404,
      "NOT_FOUND",
      "Product not found",
    );
    send(
      res,
      await db.browseEvent.create({
        data: {
          userId: req.actor!.id,
          productId: req.body.productId,
          type: "VIEW",
        },
      }),
      201,
    );
  },
);
route(
  "get",
  "/recommendations",
  "Explainable recommendations: popular, recent, related, category, frequent, personalized",
  null,
  undefined,
  async (req, res) => {
    // An optional authenticated user can personalize results; anonymous traffic gets a documented fallback.
    if (req.headers.authorization)
      await new Promise<void>((resolve, reject) =>
        authenticate(req, res, (e) => (e ? reject(e) : resolve())),
      );
    const mode = z
      .enum([
        "popular",
        "recent",
        "related",
        "category",
        "frequent",
        "personalized",
      ])
      .default("personalized")
      .parse(req.query.mode);
    const products = await db.product.findMany({
      where: { status: "ACTIVE", seller: { status: "APPROVED" } },
      include: productInclude,
      take: 1000,
      orderBy: { id: "asc" },
    });
    const events = await db.browseEvent.findMany({
      where: {
        ...(req.actor ? { userId: req.actor.id } : { type: "PURCHASE" }),
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
      include: { product: { select: { categoryId: true } } },
    });
    const popularity = await db.browseEvent.groupBy({
      by: ["productId"],
      where: { type: "PURCHASE" },
      _count: { id: true },
    });
    const recommendations = await python("/recommendations", {
      mode,
      product_id: req.query.productId ?? null,
      category_id: req.query.categoryId ?? null,
      products: products.map((i) => ({
        id: i.id,
        category_id: i.categoryId,
        popularity:
          popularity.find((n) => n.productId === i.id)?._count.id ?? 0,
      })),
      events: req.actor
        ? events.map((e) => ({
            product_id: e.productId,
            category_id: e.product.categoryId,
            type: e.type,
          }))
        : [],
      limit: 8,
    });
    send(
      res,
      recommendations.map((r: any) => ({
        ...products.find((i) => i.id === r.id),
        reason: r.reason,
      })),
    );
  },
);
route(
  "get",
  "/cart",
  "Get own cart",
  ["CUSTOMER"],
  undefined,
  async (req, res) => {
    send(
      res,
      await db.cart.upsert({
        where: { userId: req.actor!.id },
        create: { userId: req.actor!.id },
        update: {},
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: { include: { seller: { select: { name: true } } } },
                  inventory: true,
                },
              },
            },
          },
        },
      }),
    );
  },
);
route(
  "post",
  "/cart/items",
  "Add or replace a cart line; this does not reserve stock",
  ["CUSTOMER"],
  z.object({ variantId: id, quantity: qty }),
  async (req, res) => {
    const v = await db.variant.findFirst({
      where: {
        id: req.body.variantId,
        product: { status: "ACTIVE", seller: { status: "APPROVED" } },
      },
    });
    assert(v, 404, "NOT_FOUND", "Variant not found");
    const cart = await db.cart.upsert({
      where: { userId: req.actor!.id },
      create: { userId: req.actor!.id },
      update: { updatedAt: new Date() },
    });
    send(
      res,
      await db.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId: v.id } },
        create: {
          cartId: cart.id,
          variantId: v.id,
          quantity: req.body.quantity,
        },
        update: { quantity: req.body.quantity },
      }),
    );
  },
);
route(
  "delete",
  "/cart/items/:id",
  "Remove own cart line",
  ["CUSTOMER"],
  undefined,
  async (req, res) => {
    await db.cartItem.deleteMany({
      where: { id: p(req), cart: { userId: req.actor!.id } },
    });
    send(res, { removed: true });
  },
);
const addressSchema = z.object({
  name: str,
  line1: str,
  city: str,
  region: str,
  postalCode: z.string().regex(/^[A-Za-z0-9 -]{3,12}$/),
  country: z.string().length(2).default("IN"),
});
route(
  "get",
  "/addresses",
  "List own addresses",
  ["CUSTOMER"],
  undefined,
  async (req, res) =>
    send(res, await db.address.findMany({ where: { userId: req.actor!.id } })),
);
route(
  "post",
  "/addresses",
  "Save a delivery address",
  ["CUSTOMER"],
  addressSchema,
  async (req, res) =>
    send(
      res,
      await db.address.create({ data: { ...req.body, userId: req.actor!.id } }),
      201,
    ),
);
route(
  "delete",
  "/addresses/:id",
  "Remove own address",
  ["CUSTOMER"],
  undefined,
  async (req, res) => {
    await db.address.deleteMany({
      where: { id: p(req), userId: req.actor!.id },
    });
    send(res, { removed: true });
  },
);
route(
  "patch",
  "/profile",
  "Update own profile",
  [],
  z.object({ name: str }),
  async (req, res) =>
    send(
      res,
      await db.user.update({
        where: { id: req.actor!.id },
        data: { name: req.body.name },
        select: { id: true, name: true, email: true, role: true },
      }),
    ),
);
route(
  "post",
  "/checkout",
  "Reserve stock transactionally. Requires Idempotency-Key",
  ["CUSTOMER"],
  z.object({ addressId: id, coupon: z.string().trim().max(40).optional() }),
  async (req, res) =>
    send(
      res,
      await checkout(req.actor!, req.body.addressId, req.body.coupon, key(req)),
      201,
    ),
);
route(
  "get",
  "/orders",
  "List orders scoped to role and ownership",
  [],
  undefined,
  async (req, res) => {
    const { page, limit } = pageSchema.parse(req.query);
    const a = req.actor!;
    const where: Prisma.OrderWhereInput =
      a.role === "CUSTOMER"
        ? { userId: a.id }
        : a.role === "SELLER"
          ? { items: { some: { sellerId: a.sellerId } } }
          : {};
    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.order.count({ where }),
    ]);
    res.json({
      data: orders.map((o) =>
        a.role === "SELLER"
          ? {
              ...o,
              items: o.items.filter((i) => i.sellerId === a.sellerId),
              payment: undefined,
              returns: undefined,
              reservations: undefined,
              total: o.items
                .filter((i) => i.sellerId === a.sellerId)
                .reduce((n, i) => n + i.quantity * i.unitPrice - i.discount, 0),
              subtotal: undefined,
              discount: undefined,
            }
          : o,
      ),
      meta: { page, limit, total },
    });
  },
);
route(
  "get",
  "/orders/:id",
  "Get private order details",
  [],
  undefined,
  async (req, res) => {
    const o = await db.order.findUniqueOrThrow({
      where: { id: p(req) },
      include: orderInclude,
    });
    ownOrder(req.actor!, o);
    if (req.actor!.role === "SELLER")
      return send(res, {
        id: o.id,
        status: o.status,
        address: o.address,
        items: o.items.filter((i) => i.sellerId === req.actor!.sellerId),
        shipments: o.shipments.map((s) => ({
          ...s,
          items: s.items.filter((i) =>
            o.items.some(
              (oi) =>
                oi.id === i.orderItemId && oi.sellerId === req.actor!.sellerId,
            ),
          ),
        })),
      });
    send(res, o);
  },
);
route(
  "post",
  "/orders/:id/cancel",
  "Cancel an unpaid checkout and release reservations",
  ["CUSTOMER"],
  undefined,
  async (req, res) => {
    const o = await db.order.findUniqueOrThrow({ where: { id: p(req) } });
    assert(o.userId === req.actor!.id, 404, "NOT_FOUND", "Order not found");
    assert(
      ["PENDING_PAYMENT", "CANCELLED"].includes(o.status),
      409,
      "INVALID_TRANSITION",
      "Only unpaid orders can be cancelled",
    );
    await expireOrder(o.id, true);
    send(res, { cancelled: true });
  },
);
route(
  "post",
  "/orders/:id/payment-intent",
  "Create an idempotent local or Stripe test payment intent",
  ["CUSTOMER"],
  undefined,
  async (req, res) => {
    const o = await db.order.findUniqueOrThrow({ where: { id: p(req) } });
    assert(o.userId === req.actor!.id, 404, "NOT_FOUND", "Order not found");
    send(res, await paymentIntent(o.id));
  },
);
route(
  "post",
  "/orders/:id/sandbox-pay",
  "Simulate a payment locally; disabled in production",
  ["CUSTOMER"],
  z.object({ outcome: z.enum(["success", "failure"]).default("success") }),
  async (req, res) => {
    assert(
      config.DEMO_MODE === "true" &&
        config.NODE_ENV !== "production" &&
        config.PAYMENT_PROVIDER === "local",
      404,
      "NOT_FOUND",
      "Local simulator is disabled",
    );
    const o = await db.order.findUniqueOrThrow({ where: { id: p(req) } });
    assert(o.userId === req.actor!.id, 404, "NOT_FOUND", "Order not found");
    const intent = await paymentIntent(o.id);
    send(
      res,
      await paymentEvent({
        id: "sandbox_" + randomUUID(),
        providerRef: intent.providerRef,
        type: req.body.outcome === "success" ? "SUCCEEDED" : "FAILED",
        amount: o.total,
      }),
    );
  },
);
const lines = z
  .array(z.object({ orderItemId: id, quantity: qty }))
  .min(1)
  .max(100);
route(
  "post",
  "/orders/:id/shipments",
  "Prepare a partial shipment; requires Idempotency-Key",
  ["ADMIN", "WAREHOUSE", "SELLER"],
  z.object({ warehouseId: id, items: lines }),
  async (req, res) =>
    send(
      res,
      await fulfill(
        req.actor!,
        p(req),
        req.body.warehouseId,
        req.body.items,
        key(req),
      ),
      201,
    ),
);
route(
  "post",
  "/shipments/:id/simulate",
  "Advance local shipping simulator",
  ["ADMIN", "WAREHOUSE"],
  z.object({ status: z.enum(["SHIPPED", "DELIVERED", "FAILED"]) }),
  async (req, res) => {
    assert(
      config.DEMO_MODE === "true" && config.NODE_ENV !== "production",
      404,
      "NOT_FOUND",
      "Simulator disabled",
    );
    const s = await db.shipment.findUniqueOrThrow({ where: { id: p(req) } });
    send(
      res,
      await shippingEvent({
        id: "sim_" + randomUUID(),
        providerRef: s.providerRef,
        status: req.body.status,
      }),
    );
  },
);
route(
  "post",
  "/orders/:id/returns",
  "Request a bounded return after delivery",
  ["CUSTOMER"],
  z.object({ reason: z.string().min(5).max(1000), items: lines }),
  async (req, res) =>
    send(
      res,
      await requestReturn(req.actor!, p(req), req.body.reason, req.body.items),
      201,
    ),
);
route(
  "get",
  "/returns",
  "List returns scoped to customer, seller or operator",
  [],
  undefined,
  async (req, res) => {
    const a = req.actor!;
    const { page, limit } = pageSchema.parse(req.query);
    const where: Prisma.ReturnRequestWhereInput =
      a.role === "CUSTOMER"
        ? { order: { userId: a.id } }
        : a.role === "SELLER"
          ? { items: { some: { orderItem: { sellerId: a.sellerId } } } }
          : {};
    send(
      res,
      await db.returnRequest.findMany({
        where,
        include: {
          items: {
            where:
              a.role === "SELLER"
                ? { orderItem: { sellerId: a.sellerId } }
                : {},
            include: { orderItem: true },
          },
          refund: a.role !== "SELLER",
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    );
  },
);
route(
  "post",
  "/returns/:id/receive",
  "Accept and restock or reject a return",
  ["ADMIN", "SUPPORT", "WAREHOUSE"],
  z.object({ accept: z.boolean() }),
  async (req, res) => {
    const result = await receiveReturn(req.actor!, p(req), req.body.accept);
    await invalidateCatalog();
    send(res, result);
  },
);
route(
  "post",
  "/returns/:id/refund",
  "Create and process an idempotent refund",
  staff,
  undefined,
  async (req, res) => send(res, await refundReturn(req.actor!, p(req))),
);
route(
  "post",
  "/products/:id/reviews",
  "Review a delivered purchase once",
  ["CUSTOMER"],
  z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(5).max(1500),
  }),
  async (req, res) => {
    assert(
      await db.orderItem.findFirst({
        where: {
          variant: { productId: p(req) },
          order: { userId: req.actor!.id, status: "DELIVERED" },
        },
      }),
      403,
      "PURCHASE_REQUIRED",
      "Reviews require a delivered purchase",
    );
    send(
      res,
      await db.review.create({
        data: { ...req.body, userId: req.actor!.id, productId: p(req) },
      }),
      201,
    );
  },
);
route(
  "get",
  "/seller/products",
  "List own seller catalog",
  ["SELLER", "ADMIN"],
  undefined,
  async (req, res) => {
    send(
      res,
      await db.product.findMany({
        where:
          req.actor!.role === "SELLER" ? { sellerId: req.actor!.sellerId } : {},
        include: productInclude,
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  },
);
route(
  "post",
  "/seller/products",
  "Create a product for moderation",
  ["SELLER"],
  productSchema,
  async (req, res) => {
    const s = await db.seller.findUniqueOrThrow({
      where: { id: req.actor!.sellerId },
    });
    assert(
      s.status === "APPROVED",
      403,
      "SELLER_PENDING",
      "Your store must be approved before adding products",
    );
    const { variants, ...data } = req.body;
    const result = await serial(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...data,
          sellerId: s.id,
          slug:
            data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
            "-" +
            randomUUID().slice(0, 8),
          variants: { create: variants },
        },
        include: productInclude,
      });
      await audit(tx, req.actor!.id, "PRODUCT_CREATED", product.id);
      return product;
    });
    await invalidateCatalog();
    send(res, result, 201);
  },
);
route(
  "patch",
  "/seller/products/:id",
  "Edit own catalog product and resubmit moderation",
  ["SELLER", "ADMIN"],
  productSchema.omit({ variants: true }).partial(),
  async (req, res) => {
    const prod = await db.product.findUniqueOrThrow({ where: { id: p(req) } });
    assert(
      req.actor!.role === "ADMIN" || prod.sellerId === req.actor!.sellerId,
      404,
      "NOT_FOUND",
      "Product not found",
    );
    const result = await serial(async (tx) => {
      const updated = await tx.product.update({
        where: { id: prod.id },
        data: {
          ...req.body,
          status: req.actor!.role === "ADMIN" ? prod.status : "PENDING",
        },
      });
      await audit(tx, req.actor!.id, "PRODUCT_UPDATED", prod.id);
      return updated;
    });
    await invalidateCatalog();
    send(res, result);
  },
);
route(
  "patch",
  "/seller/variants/:id",
  "Update own SKU price",
  ["SELLER", "ADMIN"],
  z.object({ price: positive, name: str.optional() }),
  async (req, res) => {
    const v = await db.variant.findUniqueOrThrow({
      where: { id: p(req) },
      include: { product: true },
    });
    assert(
      req.actor!.role === "ADMIN" || v.product.sellerId === req.actor!.sellerId,
      404,
      "NOT_FOUND",
      "Variant not found",
    );
    send(res, await db.variant.update({ where: { id: v.id }, data: req.body }));
    await invalidateCatalog();
  },
);
route(
  "post",
  "/seller/products/:id/variants",
  "Add a SKU to own product",
  ["SELLER"],
  productSchema.shape.variants.element,
  async (req, res) => {
    const v = await db.product.findUniqueOrThrow({ where: { id: p(req) } });
    assert(
      v.sellerId === req.actor!.sellerId,
      404,
      "NOT_FOUND",
      "Product not found",
    );
    send(
      res,
      await db.variant.create({ data: { ...req.body, productId: v.id } }),
      201,
    );
  },
);
route(
  "post",
  "/seller/import",
  "Validate CSV in Python and atomically apply own price feed",
  ["SELLER"],
  z.object({
    csv: z.string().min(1).max(1000000),
    apply: z.boolean().default(false),
  }),
  async (req, res) => {
    const feed = await python("/feeds/validate", { csv: req.body.csv });
    if (!req.body.apply) return send(res, feed);
    assert(
      !feed.errors.length,
      422,
      "INVALID_FEED",
      "Resolve invalid rows before importing",
    );
    await serial(async (tx) => {
      for (const row of feed.records) {
        const v = await tx.variant.findUnique({
          where: { sku: row.sku },
          include: { product: true },
        });
        assert(
          v && v.product.sellerId === req.actor!.sellerId,
          403,
          "SKU_OWNERSHIP",
          "Feed contains an unknown or another seller’s SKU",
        );
        await tx.variant.update({
          where: { id: v.id },
          data: { price: row.price },
        });
      }
      await audit(
        tx,
        req.actor!.id,
        "PRICE_FEED_APPLIED",
        req.actor!.sellerId!,
        { rows: feed.records.length },
      );
    });
    await invalidateCatalog();
    send(res, { ...feed, applied: true });
  },
);
route(
  "post",
  "/seller/catalog-import",
  "Validate and atomically import a synthetic product CSV",
  ["SELLER"],
  z.object({
    csv: z.string().min(1).max(1000000),
    apply: z.boolean().default(false),
  }),
  async (req, res) => {
    const seller = await db.seller.findUniqueOrThrow({
      where: { id: req.actor!.sellerId },
    });
    assert(
      seller.status === "APPROVED",
      403,
      "SELLER_PENDING",
      "Your store must be approved",
    );
    const feed = await python("/feeds/catalog", { csv: req.body.csv });
    if (!req.body.apply) return send(res, feed);
    assert(
      !feed.errors.length,
      422,
      "INVALID_FEED",
      "Resolve invalid rows before importing",
    );
    await serial(async (tx) => {
      for (const row of feed.records) {
        const category = await tx.category.findUnique({
          where: { slug: row.category_slug },
        });
        assert(
          category,
          422,
          "INVALID_CATEGORY",
          "Unknown category: " + row.category_slug,
        );
        const existing = await tx.variant.findUnique({
          where: { sku: row.sku },
          include: { product: true },
        });
        if (existing) {
          assert(
            existing.product.sellerId === seller.id,
            403,
            "SKU_OWNERSHIP",
            "A SKU belongs to another seller",
          );
          await tx.variant.update({
            where: { id: existing.id },
            data: { price: row.price },
          });
          await tx.product.update({
            where: { id: existing.productId },
            data: {
              name: row.name,
              description: row.description,
              categoryId: category.id,
              status: "PENDING",
            },
          });
        } else
          await tx.product.create({
            data: {
              name: row.name,
              description: row.description,
              slug: "feed-" + randomUUID(),
              categoryId: category.id,
              sellerId: seller.id,
              status: "PENDING",
              image: "/products/product-1.svg",
              variants: {
                create: { sku: row.sku, name: "Standard", price: row.price },
              },
            },
          });
      }
      await audit(tx, req.actor!.id, "CATALOG_FEED_APPLIED", seller.id, {
        rows: feed.records.length,
      });
    });
    await invalidateCatalog();
    send(res, { ...feed, applied: true });
  },
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
contracts.push({
  method: "post",
  path: "/uploads",
  summary:
    "Upload a PNG, JPEG or WebP image (5 MB maximum); MIME and magic bytes verified",
  roles: ["SELLER", "ADMIN"],
});
api.post(
  "/uploads",
  authenticate,
  roles(["SELLER", "ADMIN"]),
  upload.single("image"),
  async (req, res) => {
    const f = req.file;
    assert(
      f,
      422,
      "INVALID_IMAGE",
      "Select a PNG, JPEG or WebP image up to 5 MB",
    );
    const b = f.buffer;
    assert(
      (f.mimetype === "image/png" &&
        b
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (f.mimetype === "image/jpeg" &&
          b[0] === 255 &&
          b[1] === 216 &&
          b[2] === 255) ||
        (f.mimetype === "image/webp" &&
          b.toString("ascii", 0, 4) === "RIFF" &&
          b.toString("ascii", 8, 12) === "WEBP"),
      422,
      "INVALID_IMAGE",
      "Image contents do not match the MIME type",
    );
    let safe: Buffer;
    try {
      safe = await sharp(b, { limitInputPixels: 25000000 })
        .rotate()
        .webp()
        .toBuffer();
    } catch {
      throw new ApiError(
        422,
        "INVALID_IMAGE",
        "The uploaded image cannot be decoded safely",
      );
    }
    send(res, { url: await uploadImage(safe, "image/webp") }, 201);
  },
);
route(
  "get",
  "/warehouses",
  "List warehouses",
  ["ADMIN", "SELLER", "WAREHOUSE"],
  undefined,
  async (_req, res) => send(res, await db.warehouse.findMany()),
);
route(
  "get",
  "/inventory/skus",
  "List SKUs available for inventory receipt",
  ["ADMIN", "SELLER", "WAREHOUSE"],
  undefined,
  async (req, res) =>
    send(
      res,
      await db.variant.findMany({
        where:
          req.actor!.role === "SELLER"
            ? { product: { sellerId: req.actor!.sellerId } }
            : {},
        include: { product: { select: { name: true } } },
        orderBy: { sku: "asc" },
        take: 500,
      }),
    ),
);
route(
  "get",
  "/inventory",
  "List stock and immutable movements scoped to role",
  ["ADMIN", "SELLER", "WAREHOUSE"],
  undefined,
  async (req, res) => {
    const { page, limit } = pageSchema.parse(req.query);
    send(
      res,
      await db.inventory.findMany({
        where:
          req.actor!.role === "SELLER"
            ? { variant: { product: { sellerId: req.actor!.sellerId } } }
            : {},
        include: {
          warehouse: true,
          variant: {
            include: { product: { select: { name: true, sellerId: true } } },
          },
          movements: { orderBy: { createdAt: "desc" }, take: 10 },
          reservations: { where: { status: "ACTIVE" } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: "asc" },
      }),
    );
  },
);
route(
  "post",
  "/inventory/adjust",
  "Receive or reconcile inventory with an immutable ledger entry. Requires Idempotency-Key",
  ["ADMIN", "WAREHOUSE", "SELLER"],
  z.object({
    variantId: id,
    warehouseId: id,
    delta: z
      .number()
      .int()
      .min(-100000)
      .max(100000)
      .refine((n) => n !== 0),
    reason: z.string().min(5).max(300),
  }),
  async (req, res) => {
    const k = key(req);
    const a = req.actor!;
    const result = await serial(async (tx) => {
      const replay = await tx.stockMovement.findUnique({
        where: { key: k },
        include: { inventory: true },
      });
      if (replay) {
        assert(
          replay.inventory.variantId === req.body.variantId &&
            replay.inventory.warehouseId === req.body.warehouseId &&
            replay.deltaOnHand === req.body.delta,
          409,
          "KEY_REUSED",
          "Key used for another stock adjustment",
        );
        assert(
          a.role !== "SELLER" ||
            !!(await tx.variant.findFirst({
              where: {
                id: replay.inventory.variantId,
                product: { sellerId: a.sellerId },
              },
            })),
          403,
          "FORBIDDEN",
          "Stock belongs to another seller",
        );
        return replay;
      }
      const v = await tx.variant.findUniqueOrThrow({
        where: { id: req.body.variantId },
        include: { product: true },
      });
      assert(
        a.role !== "SELLER" || v.product.sellerId === a.sellerId,
        404,
        "NOT_FOUND",
        "Variant not found",
      );
      const inv = await tx.inventory.upsert({
        where: {
          variantId_warehouseId: {
            variantId: v.id,
            warehouseId: req.body.warehouseId,
          },
        },
        create: { variantId: v.id, warehouseId: req.body.warehouseId },
        update: {},
      });
      const n =
        await tx.$executeRaw`UPDATE "Inventory" SET "onHand"="onHand"+${req.body.delta} WHERE id=${inv.id} AND "onHand"+${req.body.delta}>=reserved`;
      assert(
        n === 1,
        409,
        "STOCK_CONFLICT",
        "Adjustment would consume reserved units",
      );
      const movement = await tx.stockMovement.create({
        data: {
          inventoryId: inv.id,
          key: k,
          kind: req.body.delta > 0 ? "RECEIPT" : "RECONCILE",
          deltaOnHand: req.body.delta,
          deltaReserved: 0,
          reason: req.body.reason,
        },
      });
      await audit(tx, a.id, "INVENTORY_ADJUSTED", inv.id, {
        delta: req.body.delta,
      });
      return movement;
    });
    await invalidateCatalog();
    send(res, result);
  },
);
route(
  "get",
  "/tickets",
  "List own tickets or support queue",
  [],
  undefined,
  async (req, res) => {
    const { page, limit } = pageSchema.parse(req.query);
    send(
      res,
      await db.ticket.findMany({
        where: staff.includes(req.actor!.role) ? {} : { userId: req.actor!.id },
        include: {
          messages: true,
          dispute: true,
          assignee: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    );
  },
);
route(
  "post",
  "/tickets",
  "Create a customer support ticket",
  [],
  z.object({
    subject: str,
    message: z.string().min(5).max(3000),
    orderId: id.optional(),
  }),
  async (req, res) => {
    if (req.body.orderId)
      assert(
        await db.order.findFirst({
          where: { id: req.body.orderId, userId: req.actor!.id },
        }),
        404,
        "NOT_FOUND",
        "Order not found",
      );
    send(
      res,
      await db.ticket.create({ data: { ...req.body, userId: req.actor!.id } }),
      201,
    );
  },
);
route(
  "post",
  "/tickets/:id/messages",
  "Add a resolution message",
  [],
  z.object({ text: z.string().min(2).max(3000) }),
  async (req, res) => {
    const t = await db.ticket.findUniqueOrThrow({ where: { id: p(req) } });
    assert(
      staff.includes(req.actor!.role) || t.userId === req.actor!.id,
      404,
      "NOT_FOUND",
      "Ticket not found",
    );
    send(
      res,
      await db.ticketMessage.create({
        data: { ticketId: t.id, authorId: req.actor!.id, text: req.body.text },
      }),
      201,
    );
  },
);
route(
  "patch",
  "/tickets/:id",
  "Assign a ticket or update status",
  staff,
  z.object({
    status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
    assigneeId: id.optional(),
  }),
  async (req, res) => {
    if (req.body.assigneeId)
      assert(
        await db.user.findFirst({
          where: { id: req.body.assigneeId, role: { in: staff }, active: true },
        }),
        422,
        "INVALID_ASSIGNEE",
        "Assign to an active support agent",
      );
    send(
      res,
      await serial(async (tx) => {
        const t = await tx.ticket.update({
          where: { id: p(req) },
          data: req.body,
        });
        await audit(tx, req.actor!.id, "TICKET_UPDATED", t.id, req.body);
        return t;
      }),
    );
  },
);
route(
  "post",
  "/tickets/:id/dispute",
  "Escalate own ticket to a dispute",
  [],
  z.object({ returnId: id.optional() }),
  async (req, res) => {
    const t = await db.ticket.findUniqueOrThrow({ where: { id: p(req) } });
    assert(
      staff.includes(req.actor!.role) || t.userId === req.actor!.id,
      404,
      "NOT_FOUND",
      "Ticket not found",
    );
    if (req.body.returnId)
      assert(
        await db.returnRequest.findFirst({
          where: {
            id: req.body.returnId,
            orderId: t.orderId ?? "none",
            order: { userId: t.userId },
          },
        }),
        422,
        "INVALID_RETURN",
        "Return must belong to the ticket order",
      );
    send(
      res,
      await db.dispute.create({
        data: { ticketId: t.id, returnId: req.body.returnId },
      }),
      201,
    );
  },
);
route(
  "get",
  "/disputes",
  "List disputes",
  staff,
  undefined,
  async (_req, res) =>
    send(
      res,
      await db.dispute.findMany({
        include: { ticket: true },
        take: 100,
        orderBy: { createdAt: "desc" },
      }),
    ),
);
route(
  "patch",
  "/disputes/:id",
  "Resolve a dispute with an audit trail",
  staff,
  z.object({ resolution: z.string().min(10).max(3000) }),
  async (req, res) =>
    send(
      res,
      await serial(async (tx) => {
        const d = await tx.dispute.update({
          where: { id: p(req) },
          data: { status: "RESOLVED", resolution: req.body.resolution },
        });
        await audit(tx, req.actor!.id, "DISPUTE_RESOLVED", d.id);
        return d;
      }),
    ),
);
route(
  "get",
  "/settlements",
  "List own or marketplace settlement records",
  ["ADMIN", "SELLER"],
  undefined,
  async (req, res) =>
    send(
      res,
      await db.settlement.findMany({
        where:
          req.actor!.role === "SELLER" ? { sellerId: req.actor!.sellerId } : {},
        include: { seller: { select: { name: true } }, items: true },
        take: 100,
        orderBy: { createdAt: "desc" },
      }),
    ),
);
route(
  "get",
  "/financial-movements",
  "Read effective refund and commission reversals",
  ["ADMIN", "SELLER"],
  undefined,
  async (req, res) =>
    send(
      res,
      await db.financialMovement.findMany({
        where: {
          ...(req.actor!.role === "SELLER"
            ? { sellerId: req.actor!.sellerId }
            : {}),
          refund: { status: "SUCCEEDED" },
        },
        include: { seller: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ),
);
route(
  "post",
  "/admin/sellers/:id/settle",
  "Record a simulated seller settlement. Requires Idempotency-Key",
  ["ADMIN"],
  undefined,
  async (req, res) =>
    send(res, await settle(req.actor!, p(req), key(req)), 201),
);
route(
  "get",
  "/admin/sellers",
  "List sellers and approval status",
  ["ADMIN"],
  undefined,
  async (_req, res) =>
    send(
      res,
      await db.seller.findMany({
        include: {
          user: { select: { email: true, name: true } },
          _count: { select: { products: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ),
);
route(
  "patch",
  "/admin/sellers/:id",
  "Approve or suspend seller and configure commission",
  ["ADMIN"],
  z.object({
    status: z.enum(["PENDING", "APPROVED", "SUSPENDED"]).optional(),
    commissionBps: z.number().int().min(0).max(5000).optional(),
  }),
  async (req, res) => {
    send(
      res,
      await serial(async (tx) => {
        const s = await tx.seller.update({
          where: { id: p(req) },
          data: req.body,
        });
        await audit(tx, req.actor!.id, "SELLER_UPDATED", s.id, req.body);
        return s;
      }),
    );
    await invalidateCatalog();
  },
);
route(
  "get",
  "/admin/users",
  "List users without authentication secrets",
  ["ADMIN"],
  undefined,
  async (req, res) => {
    const { page, limit } = pageSchema.parse(req.query);
    send(
      res,
      await db.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    );
  },
);
route(
  "patch",
  "/admin/users/:id",
  "Activate or suspend a user",
  ["ADMIN"],
  z.object({ active: z.boolean() }),
  async (req, res) => {
    assert(
      p(req) !== req.actor!.id,
      409,
      "SELF_SUSPENSION",
      "You cannot suspend your own account",
    );
    send(
      res,
      await serial(async (tx) => {
        const u = await tx.user.update({
          where: { id: p(req) },
          data: req.body,
          select: { id: true, active: true },
        });
        await tx.refreshToken.updateMany({
          where: { userId: u.id },
          data: { revokedAt: new Date() },
        });
        await audit(tx, req.actor!.id, "USER_STATUS_CHANGED", u.id);
        return u;
      }),
    );
  },
);
route(
  "patch",
  "/admin/products/:id/moderate",
  "Approve, reject or archive a catalog product",
  ["ADMIN"],
  z.object({ status: z.enum(["ACTIVE", "REJECTED", "ARCHIVED"]) }),
  async (req, res) => {
    send(
      res,
      await serial(async (tx) => {
        const prod = await tx.product.update({
          where: { id: p(req) },
          data: req.body,
        });
        await audit(tx, req.actor!.id, "PRODUCT_MODERATED", prod.id, req.body);
        return prod;
      }),
    );
    await invalidateCatalog();
  },
);
route(
  "post",
  "/admin/categories",
  "Create category",
  ["ADMIN"],
  z.object({
    name: str,
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/),
  }),
  async (req, res) =>
    send(res, await db.category.create({ data: req.body }), 201),
);
route(
  "get",
  "/promotions",
  "List active promotions",
  null,
  undefined,
  async (_req, res) =>
    send(
      res,
      await db.promotion.findMany({
        where: { active: true, endsAt: { gt: new Date() } },
        select: {
          code: true,
          discountBps: true,
          minSubtotal: true,
          maxDiscount: true,
          endsAt: true,
        },
      }),
    ),
);
route(
  "post",
  "/admin/promotions",
  "Create a single-use-per-customer promotion",
  ["ADMIN"],
  z.object({
    code: z
      .string()
      .min(3)
      .max(40)
      .regex(/^[A-Z0-9]+$/),
    discountBps: z.number().int().min(1).max(5000),
    minSubtotal: z.number().int().min(0),
    maxDiscount: positive,
    endsAt: z.iso.datetime().transform((x) => new Date(x)),
  }),
  async (req, res) =>
    send(res, await db.promotion.create({ data: req.body }), 201),
);
route(
  "get",
  "/admin/audit",
  "Read security and business audit trail",
  ["ADMIN"],
  undefined,
  async (req, res) => {
    const { page, limit } = pageSchema.parse(req.query);
    send(
      res,
      await db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { name: true } } },
      }),
    );
  },
);
route(
  "get",
  "/dashboard",
  "Database-backed role metrics and recent activity",
  ["ADMIN", "SELLER", "WAREHOUSE", "SUPPORT"],
  undefined,
  async (req, res) => {
    const a = req.actor!;
    const itemWhere: Prisma.OrderItemWhereInput = {
      ...(a.role === "SELLER" ? { sellerId: a.sellerId } : {}),
      order: { payment: { is: { status: "SUCCEEDED" } } },
    };
    const [items, orderCount, products, inventory, tickets, returns, sellers] =
      await Promise.all([
        db.orderItem.findMany({
          where: itemWhere,
          include: { order: { select: { createdAt: true, status: true } } },
        }),
        db.order.count({
          where:
            a.role === "SELLER"
              ? { items: { some: { sellerId: a.sellerId } } }
              : {},
        }),
        db.product.count({
          where: a.role === "SELLER" ? { sellerId: a.sellerId } : {},
        }),
        db.inventory.findMany({
          where:
            a.role === "SELLER"
              ? { variant: { product: { sellerId: a.sellerId } } }
              : {},
        }),
        db.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        db.returnRequest.count({
          where:
            a.role === "SELLER"
              ? { items: { some: { orderItem: { sellerId: a.sellerId } } } }
              : {},
        }),
        db.seller.count({ where: { status: "PENDING" } }),
      ]);
    const refunds = await db.returnItem.findMany({
      where: {
        returnRequest: { refund: { is: { status: "SUCCEEDED" } } },
        ...(a.role === "SELLER" ? { orderItem: { sellerId: a.sellerId } } : {}),
      },
      include: {
        orderItem: true,
        returnRequest: { include: { refund: true } },
      },
    });
    const gross = items.reduce(
      (n, i) => n + i.unitPrice * i.quantity - i.discount,
      0,
    );
    const effectiveReversals = await db.financialMovement.aggregate({
      where: {
        ...(a.role === "SELLER" ? { sellerId: a.sellerId } : {}),
        refund: { status: "SUCCEEDED" },
      },
      _sum: { amount: true, commission: true },
    });
    const commission =
      items.reduce((n, i) => n + i.commission, 0) +
      (effectiveReversals._sum.commission ?? 0);
    const refunded =
      a.role === "SELLER"
        ? -(effectiveReversals._sum.amount ?? 0)
        : [
            ...new Map(
              refunds.map((i) => [
                i.returnRequest.refund!.id,
                i.returnRequest.refund!.amount,
              ]),
            ).values(),
          ].reduce((n, v) => n + v, 0);
    const days = Array.from({ length: 14 }, (_, n) => {
      const date = new Date(Date.now() - (13 - n) * 86400000)
        .toISOString()
        .slice(0, 10);
      return {
        date,
        revenue: items
          .filter((i) => i.order.createdAt.toISOString().startsWith(date))
          .reduce((s, i) => s + i.quantity * i.unitPrice - i.discount, 0),
      };
    });
    send(res, {
      ...(["ADMIN", "SELLER"].includes(a.role)
        ? {
            gross,
            refunded,
            net: gross - refunded,
            commission,
            sellerNet: gross - refunded - commission,
            series: days,
          }
        : {}),
      orderCount,
      products,
      available: inventory.reduce((s, i) => s + i.onHand - i.reserved, 0),
      reserved: inventory.reduce((s, i) => s + i.reserved, 0),
      lowStock: inventory.filter((i) => i.onHand - i.reserved <= i.threshold)
        .length,
      ...(a.role === "ADMIN" || a.role === "SUPPORT"
        ? {
            openTickets: tickets,
            returnCount: returns,
            pendingSellers: sellers,
          }
        : {}),
    });
  },
);
route(
  "get",
  "/admin/health",
  "Dependency, outbox and background job monitoring",
  ["ADMIN"],
  undefined,
  async (_req, res) => {
    const { commerceQueue } = await import("./worker-queue.js");
    send(res, {
      database: !!(await db.$queryRaw`SELECT 1`),
      redis: await redis.ping(),
      outboxPending: await db.outbox.count({ where: { processedAt: null } }),
      jobs: await commerceQueue.getJobCounts(),
      failed: await commerceQueue.getFailed(0, 20),
    });
  },
);
route(
  "post",
  "/admin/jobs/:id/retry",
  "Retry a failed idempotent background job",
  ["ADMIN"],
  undefined,
  async (req, res) => {
    const { commerceQueue } = await import("./worker-queue.js");
    const job = await commerceQueue.getJob(p(req));
    assert(job, 404, "NOT_FOUND", "Job not found");
    assert(
      (await job.getState()) === "failed",
      409,
      "JOB_NOT_FAILED",
      "Only failed jobs can be retried",
    );
    await job.retry();
    send(res, { retried: true });
  },
);
api.use((_req, _res, next) =>
  next(new ApiError(404, "NOT_FOUND", "API endpoint not found")),
);
