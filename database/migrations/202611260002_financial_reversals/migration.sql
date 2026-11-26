CREATE TABLE "FinancialMovement" (
  id TEXT NOT NULL PRIMARY KEY,
  "sellerId" TEXT NOT NULL REFERENCES "Seller"(id),
  "orderItemId" TEXT NOT NULL REFERENCES "OrderItem"(id),
  "refundId" TEXT NOT NULL REFERENCES "Refund"(id),
  amount INTEGER NOT NULL CHECK (amount <= 0),
  commission INTEGER NOT NULL CHECK (commission <= 0),
  kind TEXT NOT NULL DEFAULT 'REFUND_REVERSAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FinancialMovement_refundId_orderItemId_key" ON "FinancialMovement"("refundId","orderItemId");
CREATE INDEX "FinancialMovement_sellerId_createdAt_idx" ON "FinancialMovement"("sellerId","createdAt");
CREATE TRIGGER immutable_financial_ledger BEFORE UPDATE OR DELETE ON "FinancialMovement" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
-- Existing successful synthetic refunds predate this additive migration.
INSERT INTO "FinancialMovement" (id,"sellerId","orderItemId","refundId",amount,commission)
SELECT 'backfill-' || ri.id, oi."sellerId", oi.id, f.id,
  -CAST(((oi."unitPrice"::bigint * oi.quantity - oi.discount) * ri.quantity) / oi.quantity AS integer),
  -CAST((oi.commission::bigint * ri.quantity) / oi.quantity AS integer)
FROM "Refund" f JOIN "ReturnRequest" rr ON rr.id=f."returnId" JOIN "ReturnItem" ri ON ri."returnId"=rr.id JOIN "OrderItem" oi ON oi.id=ri."orderItemId";
