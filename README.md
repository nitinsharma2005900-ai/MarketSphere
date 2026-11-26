# MarketSphere

**Multi-Vendor Commerce, Inventory & Order Platform** — a working synthetic marketplace built with Next.js App Router, React, TypeScript, Tailwind, TanStack Query, Express, Prisma/PostgreSQL, FastAPI, Redis and BullMQ.

The original 12-page assessment is included as `project4.pdf`. Implementation scope, actual verification, and external blockers are mapped across all 15 assessments in [the traceability matrix](docs/assessments/traceability.md). No assessment scores, reviews, public URLs, or external provider success are fabricated.

Source repository: [nitinsharma2005900-ai/MarketSphere](https://github.com/nitinsharma2005900-ai/MarketSphere) (private; access is required).

## Start with Docker

Install Node.js 22+, Docker Engine with Compose v2.24+, Git, and optionally Python 3.12+ with uv for native development. On this Windows machine Docker runs inside WSL Ubuntu. Prefix Docker commands with `wsl --cd . -e` from PowerShell when Docker is not on the Windows PATH.

```powershell
npm.cmd install
node scripts/setup-local.mjs
docker compose --profile app up -d --build
```

The setup script creates independent random local database, JWT, service, webhook and object-storage secrets in ignored `.env`. It does not overwrite an existing `.env`. The first build compiles MinIO from its pinned upstream source because community images are no longer distributed. This can take several minutes. Compose waits for PostgreSQL, Redis and FastAPI health, applies migrations, seeds synthetic data, then starts the API, worker and frontend. Do not use `docker compose down -v` unless you intend to delete local data.

| Service | Local address |
|---|---|
| Customer storefront / sign-in | http://localhost:3040 |
| Seller / operations workspaces | http://localhost:3040/portal |
| Express API | http://localhost:4040/api/v1 |
| Swagger UI / OpenAPI | http://localhost:4040/api-docs · http://localhost:4040/api/openapi.json |
| FastAPI health / docs | http://localhost:8040/health · http://localhost:8040/docs |
| API readiness / metrics | http://localhost:4040/ready · http://localhost:4040/metrics |
| Mailpit captured email | http://localhost:8025 |
| MinIO S3 / console | http://localhost:9040 · http://localhost:9041 |
| PostgreSQL / Redis (loopback only) | localhost:5440 · localhost:6380 |

## Native development

Run dependency services with `docker compose up -d postgres redis mailpit minio`. Then:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
uv sync --directory services/python-service --locked
uv run --directory services/python-service --env-file ../../.env uvicorn main:app --host 0.0.0.0 --port 8040
```

Keep FastAPI running. In separate terminals, from the repository root:

```powershell
npm.cmd run db:seed
npm.cmd run dev:api
npm.cmd run worker
npm.cmd run dev:web
```

`scripts/start-local.ps1` automates native setup and starts owned processes in hidden windows with logs in `.runtime`. On Windows, stop the API and worker before regenerating Prisma Client because Windows locks loaded native DLLs. `npm run build` builds Express and Next.js. The frontend production server can be started with `npm run start -w apps/frontend`; the API with `npm run start -w apps/backend`.

## Local synthetic accounts

All accounts below use **`MarketSphere!2026`** after the default local setup. These are deliberately public synthetic local demo credentials, unrelated to generated infrastructure secrets. Changing `DEMO_PASSWORD` before the first seed changes the local seed password; the demo form preset should then be entered manually. Re-running the idempotent seed does not reset existing accounts.

| Role | Email |
|---|---|
| Customer | customer@marketsphere.test |
| Second customer | customer2@marketsphere.test |
| Seller | seller@marketsphere.test |
| Other independent sellers | seller2@marketsphere.test through seller5@marketsphere.test |
| Warehouse operator | warehouse@marketsphere.test |
| Support agent | support@marketsphere.test |
| Administrator | admin@marketsphere.test |

Use the role buttons on `/login` to fill a demo account, then sign in. Public seller registration starts **PENDING**; an administrator approves it. Five approved seed sellers, six categories, fifty illustrated products, one hundred SKUs, two warehouses, reviews, orders, shipments, returns, refunds, settlements, tickets and synthetic browsing/purchase events are included. New registration accepts only customer or seller roles. Production mode forbids demo seeding and local payment/shipping simulation endpoints.

## Main workflows

- Customer: discover/search/filter/sort products, select SKU, add to bag, manage addresses, reserve checkout with an optional WELCOME10 coupon, confirm a local sandbox payment, track orders, return delivered items, review verified purchases, manage profile and support conversations.
- Seller: create/edit products and SKUs, upload sanitized images to MinIO, validate/apply price or catalog CSVs, receive inventory, manage own fulfillment, review sales, commission, settlements and refund reversals. Catalog imports enter moderation.
- Warehouse: receive/reconcile stock, inspect immutable movements and reservations, prepare partial shipments, advance local shipment status, and inspect received returns. Quantities are bounded by the source warehouse allocation.
- Support: assign tickets, record messages and resolutions, manage disputes, receive/reject returns and issue retry-safe sandbox refunds.
- Administrator: approve/suspend sellers, moderate products, manage users/categories/promotions, monitor orders and jobs, retry failed jobs, read audit records and record simulated settlements.

## Tests and evidence

Use a dedicated PostgreSQL test database. Never use a production database for tests.

```powershell
docker compose exec -T postgres createdb -U marketsphere marketsphere_test
node scripts/setup-tests.mjs
npm.cmd test
uv run --directory services/python-service pytest -v -s --cov=main --cov-report=json:../../docs/evidence/python-coverage.json --junitxml=../../docs/evidence/python-results.xml
uv run --directory services/python-service ruff check .
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

If the test database already exists, skip `createdb`. `setup-tests.mjs` writes only the test connection URL into ignored `.env.test`, then migrates it. API tests reject a database name without the `_test` suffix. Real local MinIO/Mailpit tests run when their local environment variables are configured; CI without those sandbox services explicitly skips those two adapter checks.

See [actual test execution](docs/test-report.md), [machine-readable capstone evidence](docs/evidence/capstone.json), and raw Vitest, Pytest, Playwright and coverage reports under `docs/evidence`. The capstone uses two independent API login sessions and simultaneous HTTP requests against PostgreSQL; it does not mock inventory. Five signed payment replays and five refund replays verify single financial/stock effects.

## Documentation and operations

- [System architecture and checkout flow](docs/architecture/system.md)
- [Generated database ER diagram](docs/architecture/database-er.md)
- [Security, isolation and concurrency](docs/security-and-concurrency.md)
- [Incident reproductions and RCA](docs/incidents/incident-rca.md)
- [Deployment, HTTPS and rollback](docs/deployment.md)
- [Environment variables and sandbox keys](docs/environment.md)
- [OpenAPI specification](docs/openapi.json) and [Postman collection](postman/MarketSphere.postman_collection.json)
- [Assessment status and evidence](docs/assessments/traceability.md)
- [15-page project documentation PDF](docs/MarketSphere_Project_Documentation.pdf)
- [Contribution and migration review guidelines](CONTRIBUTING.md)

`bash scripts/backup.sh` creates a PostgreSQL custom-format backup under ignored `.runtime/backups`; `bash scripts/verify-restore.sh <archive-path>` restores it into a new isolated database and checks inventory constraints. Backups never enter Git or the submission ZIP. Important records use database transactions, an immutable audit/stock/financial trail, a transactional outbox, bounded retries, failed-job monitoring, request IDs and structured logs.

GitHub Actions quality workflows and a manually dispatched staging/production release workflow are included. Production approval and remote branch protection require repository-owner configuration. Registry publishing and deployment are never asserted until an actual successful run exists. No paid service is provisioned automatically. Full public hosting requires a VM or managed environment supporting the complete architecture, owner-controlled DNS and sandbox credentials.

Regenerate exported API contracts with `npx tsx scripts/export-api.ts`, documentation with `uv run --directory services/python-service python ../../scripts/build-docs.py`, and the final verified archive with `uv run --directory services/python-service python ../../scripts/package-project.py`. The archive is `MarketSphere_Complete_Project.zip` in this workspace and excludes actual environment files, dependencies, caches, runtime data, virtual environments, Git internals and build output.
