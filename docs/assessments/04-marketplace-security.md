# Assessment 04 — Marketplace security

**Status:** Implemented and verified

Bcrypt, JWT/refresh reuse revocation, Origin/CORS, server RBAC and ownership, upload decode/re-encode, rate limits and audit trail.

## Implementation

apps/backend/src/auth.ts; http.ts; app.ts; providers.ts

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

tests/integration/commerce.test.ts

Actual evidence: `docs/evidence/vitest-results.json; npm-audit.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
