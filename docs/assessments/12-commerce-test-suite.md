# Assessment 12 — Commerce test suite

**Status:** Partial or simulated

Success, authorization, invalid input, concurrency, expiry, duplicate events/refunds, failed shipping recovery and provider-local integration tests. Coverage is reported as measured, not complete.

## Implementation

tests/integration/; tests/frontend/; tests/e2e/; python tests/

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

Vitest, Supertest, RTL, Pytest, HTTPX, Playwright

Actual evidence: `docs/evidence/vitest-results.json; python-results.xml; playwright-results.json; coverage/`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
