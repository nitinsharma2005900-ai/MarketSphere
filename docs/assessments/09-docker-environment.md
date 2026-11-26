# Assessment 09 — Docker environment

**Status:** Partial or simulated

Frontend, API, FastAPI, PostgreSQL, Redis, worker, migration job, MinIO and Mailpit. Alternate verification ports permit coexistence with native development.

## Implementation

docker-compose.yml; infrastructure/docker/; services/python-service/Dockerfile

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

Full Compose build/start and HTTP smoke checks

Actual evidence: `docs/evidence/container-status.json; service-health.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
