#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup="${1:?Supply a pg_dump archive path}"
test -s "$backup"
# Restore only into an isolated scratch database. No production database is dropped.
restore_db="marketsphere_restore_$(date -u +%Y%m%d%H%M%S)"
docker compose exec -T postgres createdb -U marketsphere "$restore_db"
docker compose exec -T postgres pg_restore -U marketsphere -d "$restore_db" --exit-on-error < "$backup"
docker compose exec -T postgres psql -U marketsphere -d "$restore_db" -v ON_ERROR_STOP=1 -c 'SELECT (SELECT count(*) FROM "Product") AS products, (SELECT count(*) FROM "Order") AS orders, (SELECT count(*) FROM "StockMovement") AS movements;'
docker compose exec -T postgres psql -U marketsphere -d "$restore_db" -v ON_ERROR_STOP=1 -c 'DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Inventory" WHERE "onHand" < 0 OR reserved < 0 OR reserved > "onHand") THEN RAISE EXCEPTION '\''Inventory invariant failed'\''; END IF; END $$;'
printf 'Restore verified in isolated database %s\n' "$restore_db"
