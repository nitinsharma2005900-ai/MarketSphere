# Assessment 06 — Recommendation service

**Status:** Implemented and verified

Popular, recently viewed, related, category, frequent and personalized modes with deterministic explainable cold-start fallback.

## Implementation

services/python-service/main.py; apps/backend/src/python.ts; frontend storefront.tsx

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

test_processing.py; commerce.test.ts

Actual evidence: `docs/evidence/python-results.xml; vitest-results.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
