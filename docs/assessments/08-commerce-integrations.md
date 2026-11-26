# Assessment 08 — Commerce integrations

**Status:** Partial or simulated

MinIO upload/download and Mailpit capture verified locally. Payments, shipping and settlements use explicit local simulators. Stripe test adapter exists but genuine provider credentials/events are unverified.

## Implementation

apps/backend/src/providers.ts; app.ts; worker.ts; docker-compose.yml

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

tests/integration/commerce.test.ts

Actual evidence: `docs/evidence/vitest-results.json; service-health.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
