import { config as load } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
load({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const env = z
  .object({
    NODE_ENV: z.string().default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default("redis://localhost:6380"),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    INTERNAL_SERVICE_TOKEN: z.string().min(32),
    PAYMENT_WEBHOOK_SECRET: z.string().min(32),
    SHIPPING_WEBHOOK_SECRET: z.string().min(32),
    PYTHON_SERVICE_URL: z.string().url().default("http://localhost:8040"),
    FRONTEND_URL: z.string().url().default("http://localhost:3040"),
    PORT: z.coerce.number().default(4040),
    RESERVATION_SECONDS: z.coerce.number().int().positive().default(900),
    DEMO_MODE: z.string().default("false"),
    PAYMENT_PROVIDER: z.enum(["local", "stripe"]).default("local"),
  })
  .parse(process.env);
if (env.NODE_ENV === "production" && env.DEMO_MODE === "true")
  throw new Error("Demo mode must be disabled in production");
export const config = env;
