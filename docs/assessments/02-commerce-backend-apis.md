# Assessment 02 — Commerce backend APIs

**Status:** Implemented and verified

Versioned validated APIs, role/resource scoping and explicit order/payment/shipping/return/settlement transitions.

## Implementation

apps/backend/src/routes.ts; commerce.ts; auth.ts; http.ts

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

tests/integration/commerce.test.ts

Actual evidence: `docs/evidence/vitest-results.json; capstone.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
