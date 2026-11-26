import { z } from "zod";
import { contracts } from "./routes.js";
import { registerSchema } from "./auth.js";
import { Prisma } from "@prisma/client";

export function openapi() {
  const models: Record<string, any> = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    const properties: Record<string, any> = {};
    for (const f of model.fields) {
      if (["passwordHash", "tokenHash", "tokens"].includes(f.name)) continue;
      let shape: any =
        f.kind === "object"
          ? { $ref: "#/components/schemas/" + f.type }
          : f.kind === "enum"
            ? {
                type: "string",
                enum: Prisma.dmmf.datamodel.enums
                  .find((e) => e.name === f.type)
                  ?.values.map((v) => v.name),
              }
            : f.type === "Int"
              ? { type: "integer" }
              : f.type === "Boolean"
                ? { type: "boolean" }
                : f.type === "DateTime"
                  ? { type: "string", format: "date-time" }
                  : f.type === "Json"
                    ? {}
                    : { type: "string" };
      if (f.isList) shape = { type: "array", items: shape };
      else if (!f.isRequired) shape = { anyOf: [shape, { type: "null" }] };
      properties[f.name] = shape;
    }
    models[model.name] = {
      type: "object",
      properties,
      required: model.fields
        .filter(
          (f) =>
            f.kind !== "object" &&
            f.isRequired &&
            !["passwordHash", "tokenHash"].includes(f.name),
        )
        .map((f) => f.name),
    };
  }
  const entries = [
    ...contracts,
    {
      method: "post",
      path: "/auth/register",
      summary: "Register a customer or pending seller",
      roles: [],
      schema: registerSchema,
    },
    {
      method: "post",
      path: "/auth/login",
      summary:
        "Sign in; access token in body, refresh token in HttpOnly cookie",
      roles: [],
      schema: z.object({ email: z.email(), password: z.string() }),
    },
    {
      method: "post",
      path: "/auth/refresh",
      summary: "Rotate refresh cookie; trusted Origin header required",
      roles: [],
      schema: undefined,
    },
    {
      method: "post",
      path: "/auth/logout",
      summary: "Revoke refresh sessions",
      roles: [],
      authenticated: true,
      schema: undefined,
    },
    {
      method: "get",
      path: "/auth/me",
      summary: "Current user profile",
      roles: [],
      authenticated: true,
      schema: undefined,
    },
  ];
  const paths: Record<string, any> = {};
  for (const c of entries) {
    const path = "/api/v1" + c.path.replace(/:([\w]+)/g, "{$1}");
    const body = c.schema
      ? z.toJSONSchema(c.schema, { unrepresentable: "any", io: "input" })
      : undefined;
    const parameters: any[] = [...c.path.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    if (
      c.method === "get" &&
      [
        "/products",
        "/orders",
        "/inventory",
        "/returns",
        "/tickets",
        "/admin/users",
        "/admin/audit",
      ].includes(c.path)
    )
      parameters.push(
        ...["page", "limit"].map((name) => ({
          name,
          in: "query",
          required: false,
          schema: {
            type: "integer",
            minimum: 1,
            maximum: name === "limit" ? 100 : 10000,
          },
        })),
      );
    if (
      ["/checkout", "/inventory/adjust"].includes(c.path) ||
      c.path.endsWith("/shipments") ||
      c.path.endsWith("/settle")
    )
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 8, maxLength: 120 },
      });
    paths[path] ??= {};
    paths[path][c.method] = {
      summary: c.summary,
      description: c.roles.length
        ? `Allowed roles: ${c.roles.join(", ")}. Resource ownership is enforced server-side.`
        : "See the endpoint contract for public or session requirements.",
      tags: [c.path.split("/")[1]],
      security:
        ("authenticated" in c && c.authenticated) || c.roles.length
          ? [{ bearerAuth: [] }]
          : [],
      parameters,
      ...(body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: body } },
            },
          }
        : {}),
      responses: {
        "200": {
          description: "Successful result",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Success" },
            },
          },
        },
        "201": { description: "Created record" },
        "401": { description: "Missing or invalid authentication" },
        "403": { description: "Role or origin forbidden" },
        "404": { description: "Resource not found or inaccessible" },
        "409": {
          description:
            "Invalid state, idempotency conflict or insufficient stock",
        },
        "422": { description: "Invalid fields or business inputs" },
        "429": { description: "Rate limit exceeded" },
        "503": {
          description:
            "Dependency unavailable; retry with the same idempotency key",
        },
      },
    };
  }
  for (const name of ["payments", "shipping", "refunds"]) {
    paths["/api/v1/webhooks/" + name] = {
      post: {
        summary: `Signed local ${name} callback`,
        description:
          "X-Webhook-Signature = lowercase hex HMAC-SHA256(raw bytes, configured webhook secret). Each event id is unique. Replay is safe.",
        parameters: [
          {
            name: "X-Webhook-Signature",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "providerRef"],
                properties: {
                  id: { type: "string" },
                  providerRef: { type: "string" },
                  ...(name === "payments"
                    ? {
                        type: { enum: ["SUCCEEDED", "FAILED"] },
                        amount: { type: "integer", minimum: 0 },
                      }
                    : name === "shipping"
                      ? { status: { enum: ["SHIPPED", "DELIVERED", "FAILED"] } }
                      : {}),
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Applied, duplicate, or ignored event" },
          401: { description: "Invalid signature" },
          409: { description: "Invalid transition or event conflict" },
          422: { description: "Invalid event or amount" },
        },
      },
    };
  }
  const responseModels: Record<string, string> = {
    "/products": "Product",
    "/seller/products": "Product",
    "/categories": "Category",
    "/cart": "Cart",
    "/orders": "Order",
    "/checkout": "Order",
    "/addresses": "Address",
    "/inventory": "Inventory",
    "/warehouses": "Warehouse",
    "/returns": "ReturnRequest",
    "/tickets": "Ticket",
    "/disputes": "Dispute",
    "/settlements": "Settlement",
    "/financial-movements": "FinancialMovement",
    "/admin/sellers": "Seller",
    "/admin/users": "User",
    "/promotions": "Promotion",
    "/admin/audit": "AuditLog",
  };
  for (const [path, operations] of Object.entries(paths))
    for (const [method, operation] of Object.entries(
      operations as Record<string, any>,
    )) {
      const short = path.replace("/api/v1", "");
      const match = Object.keys(responseModels)
        .sort((a, b) => b.length - a.length)
        .find((prefix) => short === prefix || short === prefix + "/{id}");
      if (match) {
        const entity = {
          $ref: "#/components/schemas/" + responseModels[match],
        };
        const array =
          method === "get" &&
          !short.includes("{id}") &&
          !["/cart", "/checkout"].includes(short);
        const schema = {
          type: "object",
          required: ["data"],
          properties: {
            data: array ? { type: "array", items: entity } : entity,
            meta: {
              type: "object",
              properties: {
                page: { type: "integer" },
                limit: { type: "integer" },
                total: { type: "integer" },
                pages: { type: "integer" },
              },
            },
          },
        };
        for (const status of ["200", "201"])
          if (operation.responses[status])
            operation.responses[status].content = {
              "application/json": { schema },
            };
      }
      for (const [status, response] of Object.entries(
        operation.responses as Record<string, any>,
      ))
        if (Number(status) >= 400)
          response.content = {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          };
    }
  paths["/api/v1/products"].get.parameters.push(
    ...["search", "category", "seller"].map((name) => ({
      name,
      in: "query",
      schema: { type: "string" },
    })),
    ...["min", "max"].map((name) => ({
      name,
      in: "query",
      description: "Price in integer paise",
      schema: { type: "integer", minimum: 0 },
    })),
    {
      name: "sort",
      in: "query",
      schema: {
        type: "string",
        enum: ["newest", "name", "price-asc", "price-desc"],
      },
    },
  );
  paths["/api/v1/recommendations"].get.parameters = [
    {
      name: "mode",
      in: "query",
      schema: {
        enum: [
          "popular",
          "recent",
          "related",
          "category",
          "frequent",
          "personalized",
        ],
      },
    },
    ...["productId", "categoryId"].map((name) => ({
      name,
      in: "query",
      schema: { type: "string" },
    })),
  ];
  paths["/api/v1/uploads"].post.requestBody = {
    required: true,
    content: {
      "multipart/form-data": {
        schema: {
          type: "object",
          required: ["image"],
          properties: { image: { type: "string", format: "binary" } },
        },
      },
    },
  };
  paths["/api/v1/webhooks/stripe"] = {
    post: {
      summary: "Stripe test-mode webhook",
      description:
        "Raw Stripe event with Stripe-Signature header verified with STRIPE_WEBHOOK_SECRET. Handles payment_intent.succeeded, payment_intent.payment_failed and succeeded refund.updated events. Other event types are acknowledged without side effects.",
      parameters: [
        {
          name: "Stripe-Signature",
          in: "header",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        200: { description: "Applied or ignored event" },
        401: { description: "Invalid Stripe signature" },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "MarketSphere Commerce API",
      version: "1.0.0",
      description:
        "INR amounts are integer paise. Pagination: page (1-based), limit (1..100). Responses use data and optional meta. Orders: PENDING_PAYMENT → PAID → PARTIALLY_FULFILLED → FULFILLED → DELIVERED; unpaid orders may become CANCELLED, EXPIRED, PAYMENT_FAILED. Returns: REQUESTED → RECEIVED → REFUNDED or REJECTED. Local payment, shipping and settlement are simulators. Stripe test adapter requires external verification.",
    },
    servers: [{ url: "http://localhost:4040" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        ...models,
        Success: {
          type: "object",
          required: ["data"],
          properties: { data: {}, meta: { type: "object" } },
        },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}
