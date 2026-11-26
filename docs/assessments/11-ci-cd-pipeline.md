# Assessment 11 — CI/CD pipeline

**Status:** Implemented but not externally verified

Quality/security/container CI is recorded separately from release deployment. Registry release, staging/production approval and rollback are configured but require genuine owner-controlled execution.

## Implementation

.github/workflows/ci.yml; release.yml

## Setup and usage

Follow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.

## Verification

GitHub Actions quality workflow when available

Actual evidence: `docs/evidence/github-ci.json; build-results.json`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.
