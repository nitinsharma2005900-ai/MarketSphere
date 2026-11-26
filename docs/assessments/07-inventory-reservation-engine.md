# Assessment 07 — Inventory reservation engine

**Status:** Implemented and verified

Real concurrent PostgreSQL last-item checkout, immutable movements, expiry, bounded retries, late-payment compensation and partial fulfillment.

## Implementation

apps/backend/src/commerce.ts; repository.ts; worker.ts; migrations/

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

tests/integration/commerce.test.ts

Actual evidence: `docs/evidence/capstone.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
