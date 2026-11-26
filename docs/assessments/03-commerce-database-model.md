# Assessment 03 — Commerce database model

**Status:** Implemented and verified

Normalized PostgreSQL model, keys, constraints, indexes and immutable stock/audit/financial ledgers. Generated ER matches actual schema.

## Implementation

database/schema.prisma; database/migrations/; database/seed.ts

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

tests/integration/commerce.test.ts

Actual evidence: `docs/evidence/capstone.json; backup-restore.txt`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
