# Assessment 15 — Incident simulation and RCA

**Status:** Implemented and verified

Overselling, stale cache/reservations, payment mismatch, indexed bounded search, failed callback recovery and duplicate refund. Small-data plans are not a production-load performance claim.

## Implementation

docs/incidents/incident-rca.md; commerce.ts; repository.ts

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

Six controlled regression scenarios in commerce.test.ts

Actual evidence: `docs/evidence/capstone.json; vitest-results.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
