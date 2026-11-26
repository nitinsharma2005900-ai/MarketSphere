import { Worker } from "bullmq";
import { db, redis, logger } from "./repository.js";
import { commerceQueue } from "./worker-queue.js";
import {
  expireOrder,
  processRefund,
  reconcileLatePayment,
  paymentEvent,
} from "./commerce.js";
import { sendEmail, stripe } from "./providers.js";
import { config } from "./config.js";
let stopping = false;
export async function dispatch() {
  const pending = await db.outbox.findMany({
    where: { processedAt: null },
    take: 100,
    orderBy: { createdAt: "asc" },
  });
  for (const event of pending) {
    const payload = event.payload as any;
    await commerceQueue.add(event.type, payload, {
      jobId: event.id,
      delay:
        event.type === "RESERVATION_EXPIRY"
          ? Math.max(0, new Date(payload.expiresAt).getTime() - Date.now())
          : 0,
    });
    await db.outbox.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  }
}
export const worker = new Worker(
  "marketsphere-commerce",
  async (job) => {
    const p = job.data;
    if (job.name === "RESERVATION_EXPIRY") await expireOrder(p.orderId);
    else if (job.name === "REFUND") await processRefund(p.refundId);
    else if (job.name === "LATE_REFUND")
      await reconcileLatePayment(p.paymentId);
    else if (job.name === "ORDER_EMAIL") {
      const o = await db.order.findUniqueOrThrow({
        where: { id: p.orderId },
        include: { user: true },
      });
      await sendEmail(
        o.user.email,
        "Your MarketSphere order is confirmed",
        `Sandbox confirmation: order ${o.id} is ${o.status}. No real payment was processed.`,
      );
    } else throw new Error("Unknown commerce job");
  },
  { connection: redis.duplicate() as any, concurrency: 4 },
);
worker.on("failed", (job, err) =>
  logger.error(
    { jobId: job?.id, message: err.message },
    "Background job failed",
  ),
);
worker.on("completed", (job) =>
  logger.info({ jobId: job.id, type: job.name }, "Background job completed"),
);
let busy = false;
const tick = async () => {
  if (busy || stopping) return;
  busy = true;
  try {
    await redis.set("worker:heartbeat", new Date().toISOString(), "EX", 30);
    await dispatch();
    for (const o of await db.order.findMany({
      where: { status: "PENDING_PAYMENT", expiresAt: { lt: new Date() } },
      take: 100,
    }))
      await expireOrder(o.id);
    if (config.PAYMENT_PROVIDER === "stripe")
      for (const p of await db.payment.findMany({
        where: { status: "PENDING", providerRef: { startsWith: "pi_" } },
        take: 25,
      })) {
        const remote = await stripe().paymentIntents.retrieve(p.providerRef);
        if (remote.status === "succeeded")
          await paymentEvent({
            id: `reconcile_${remote.id}`,
            providerRef: remote.id,
            type: "SUCCEEDED",
            amount: remote.amount_received,
          });
      }
  } catch (err) {
    logger.error({ err }, "Worker dispatch failed");
  } finally {
    busy = false;
  }
};
const timer = setInterval(() => void tick(), 5000);
void tick();
async function stop() {
  stopping = true;
  clearInterval(timer);
  await worker.close();
  await commerceQueue.close();
  await redis.quit();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
logger.info("MarketSphere worker started");
