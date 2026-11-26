-- Authoritative integrity boundaries, in addition to Prisma foreign keys and unique indexes.
ALTER TABLE "Inventory" ADD CONSTRAINT inventory_nonnegative CHECK ("onHand" >= 0 AND reserved >= 0 AND reserved <= "onHand");
ALTER TABLE "Variant" ADD CONSTRAINT variant_positive_price CHECK (price > 0);
ALTER TABLE "CartItem" ADD CONSTRAINT cart_positive_quantity CHECK (quantity > 0 AND quantity <= 100);
ALTER TABLE "Reservation" ADD CONSTRAINT reservation_positive_quantity CHECK (quantity > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT order_line_integrity CHECK (quantity > 0 AND fulfilled >= 0 AND fulfilled <= quantity AND "unitPrice" > 0 AND discount >= 0 AND discount <= quantity * "unitPrice" AND commission >= 0);
ALTER TABLE "Order" ADD CONSTRAINT order_amount_integrity CHECK (subtotal >= 0 AND discount >= 0 AND discount <= subtotal AND total = subtotal - discount + shipping);
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_integrity CHECK (amount >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT refund_amount_integrity CHECK (amount >= 0);
ALTER TABLE "Seller" ADD CONSTRAINT seller_commission_range CHECK ("commissionBps" BETWEEN 0 AND 5000);
ALTER TABLE "Review" ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "ShipmentItem" ADD CONSTRAINT shipment_quantity_positive CHECK (quantity > 0);
ALTER TABLE "ReturnItem" ADD CONSTRAINT return_quantity_positive CHECK (quantity > 0);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX product_name_search_idx ON "Product" USING gin (name gin_trgm_ops);
CREATE INDEX product_description_search_idx ON "Product" USING gin (description gin_trgm_ops);
CREATE FUNCTION prevent_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable ledger records cannot be updated or deleted'; END $$;
CREATE TRIGGER immutable_stock_ledger BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
CREATE TRIGGER immutable_audit_trail BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
