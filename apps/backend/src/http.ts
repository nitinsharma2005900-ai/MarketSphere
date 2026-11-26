import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import { db, logger } from "./repository.js";
import { config } from "./config.js";
export type Actor = { id: string; role: Role; sellerId?: string };
declare module "express-serve-static-core" {
  interface Request {
    actor?: Actor;
    requestId: string;
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const bearer = req.headers.authorization;
    assert(
      bearer && bearer.startsWith("Bearer "),
      401,
      "UNAUTHENTICATED",
      "Please sign in",
    );
    const payload = jwt.verify(bearer.slice(7), config.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: "marketsphere",
      audience: "marketsphere-web",
    }) as jwt.JwtPayload;
    const user = await db.user.findUnique({
      where: { id: payload.sub },
      include: { seller: true },
    });
    assert(
      user?.active,
      401,
      "UNAUTHENTICATED",
      "Your session is no longer active",
    );
    req.actor = { id: user.id, role: user.role, sellerId: user.seller?.id };
    next();
  } catch (e) {
    next(
      e instanceof ApiError
        ? e
        : new ApiError(401, "INVALID_TOKEN", "Invalid or expired access token"),
    );
  }
}
export const roles =
  (allowed: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor || !allowed.includes(req.actor.role))
      return next(
        new ApiError(
          403,
          "FORBIDDEN",
          "This action is not available to your role",
        ),
      );
    next();
  };
export function errorHandler(
  e: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status =
    e instanceof ZodError
      ? 422
      : (e.status ??
        (e.code === "LIMIT_FILE_SIZE"
          ? 413
          : e.code === "P2002"
            ? 409
            : e.code === "P2025"
              ? 404
              : 500));
  if (status >= 500)
    logger.error({ err: e, requestId: req.requestId }, "Request failed");
  res
    .status(status)
    .json({
      error: {
        code:
          e instanceof ZodError
            ? "VALIDATION_ERROR"
            : e instanceof ApiError
              ? e.code
              : status === 409
                ? "CONFLICT"
                : status === 404
                  ? "NOT_FOUND"
                  : "INTERNAL_ERROR",
        message:
          e instanceof ZodError
            ? "Please check the submitted fields"
            : e instanceof ApiError
              ? e.message
              : status === 409
                ? "This operation conflicts with an existing record"
                : status === 404
                  ? "Record not found"
                  : "The request could not be completed",
        ...(e instanceof ZodError ? { fields: e.flatten() } : {}),
        requestId: req.requestId,
      },
    });
}
export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
}
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export const keySchema = z
  .string()
  .min(8)
  .max(120)
  .regex(/^[\w:-]+$/);
export function key(req: Request) {
  return keySchema.parse(req.headers["idempotency-key"]);
}
export function ownOrder(
  actor: Actor,
  order: { userId: string; items: { sellerId: string }[] },
) {
  assert(
    actor.role === "ADMIN" ||
      actor.role === "WAREHOUSE" ||
      actor.role === "SUPPORT" ||
      order.userId === actor.id ||
      (actor.role === "SELLER" &&
        order.items.some((i) => i.sellerId === actor.sellerId)),
    404,
    "NOT_FOUND",
    "Order not found",
  );
}
