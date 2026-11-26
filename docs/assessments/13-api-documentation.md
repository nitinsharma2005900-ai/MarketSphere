# Assessment 13 — API documentation

**Status:** Implemented and verified

Request schemas, entity contracts, permissions, pagination/filtering, state transitions, signed callbacks and idempotency requirements. Postman includes generated example payloads.

## Implementation

apps/backend/src/openapi.ts; docs/openapi.json; postman/

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

Generated JSON export, running Swagger and API tests

Actual evidence: `docs/evidence/service-health.json; docs/openapi.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
