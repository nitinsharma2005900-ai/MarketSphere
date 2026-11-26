# Deployment, environments and rollback

The complete stack needs Next.js, Express, FastAPI, PostgreSQL, Redis and a continuously running worker. A small Linux VM with Docker Compose and Caddy is the most direct deployment target. The implementation does not remove required services to fit a free tier. [Render service types](https://render.com/docs/service-types), [background workers](https://render.com/docs/background-workers), and [free-instance limitations](https://render.com/docs/free) were checked; a full architecture must account for worker and datastore constraints rather than claiming it is entirely free.

## Prepare a staging host

1. Provision a suitable Linux host through your own account. No billing resource has been authorized or created by this project. Install current Docker Engine and Compose supporting `!reset` overrides, and reserve sufficient memory for frontend builds and the MinIO source build.
2. Clone the project, copy `.env.example` to a private root `.env`, and supply independent staging secrets. Set `NODE_ENV=production`, `DEMO_MODE=false`, an actual `MARKETSPHERE_DOMAIN`, matching HTTPS FRONTEND_URL/NEXT_PUBLIC_API_URL, and Stripe **test** credentials if testing payment confirmation. Do not seed public demo accounts.
3. Point the domain's A/AAAA records to the host and allow inbound 80/443. Keep PostgreSQL, Redis, MinIO and FastAPI on the private Compose network. The production override removes host bindings for them and exposes only Caddy.
4. Run `docker compose -f docker-compose.yml -f infrastructure/deployment/compose.production.yml --profile app up -d --build`. The migration service applies schema only; the production override removes synthetic seeding. Caddy obtains/renews HTTPS certificates for the actual domain. Verify DNS, certificate, storefront, authenticated API, processing service and worker status.
5. Set ADMIN_EMAIL to an owner-controlled `@marketsphere.test` address and ADMIN_PASSWORD to a fresh password of at least 16 characters in the private server environment. Recreate the API container to load those variables, then run `docker compose exec api npx tsx database/bootstrap-admin.ts`. This owner-only CLI records an audit entry and is never exposed through HTTP. Use fresh credentials instead of README demo passwords. Register a customer and seller, approve the seller through the administrator, create/moderate a product, receive stock and perform genuine Stripe test-mode verification before describing external payment integration as verified.

The supplied configuration is an educational production-like environment. Local simulator payment and shipping control endpoints are disabled in production. The Stripe REST adapter supports test intents/events/refunds, but the current customer UI uses the local simulator, so a complete publicly usable Stripe checkout still requires a Stripe Elements UI and provider-side verification. External carrier and email delivery are also not claimed.

## Operational validation

- `/health` checks the API process; `/ready` checks PostgreSQL, Redis and FastAPI and reports worker heartbeat. Keep Python internal; its processing endpoints require the separate internal token.
- `/metrics` provides basic request/error counts and process uptime. Structured API/worker logs include request IDs and safe error details. Admin System health exposes job counts, pending outbox records and retry controls for failed idempotent jobs.
- Caddy compresses responses and terminates HTTPS. Next.js caches immutable build assets; sanitized object-storage files use immutable Cache-Control. Database indexes support collection/search and ownership patterns.
- Run backups on a host timer, encrypt copies in your own backup destination and apply a retention policy. `scripts/backup.sh` creates the archive; `scripts/verify-restore.sh` restores to a new scratch database and verifies basic counts and inventory invariants. The local restore verification is captured under evidence.

## CI/CD and owner settings

`Marketplace quality` runs lint/type checks, React/API/Python tests, npm auditing, builds and browser journeys; separate jobs build application images. The repository owner must supply real CODEOWNERS entries, require appropriate checks on main, prohibit force pushes and create staging/production GitHub environments. Require human reviewers for production.

`Approved release` is manual. It publishes SHA-tagged images to GHCR and calls an owner-configured environment `DEPLOY_HOOK`, passing the image tag. Configure `API_PUBLIC_URL` as an environment variable and `DEPLOY_HOOK` as an environment secret. The hook's implementation is host-specific and is not fabricated by the project. Keep deployment accounts least privileged.

An actual attempt to protect the private main branch returned HTTP 403 with GitHub's requirement to upgrade the account plan or change repository visibility. The repository remains private and no paid change was made. See `docs/evidence/branch-protection-result.txt`; the owner can decide how to enable that setting later. Independent human review remains outstanding.

To roll back application code, dispatch the release workflow with a previously verified immutable `rollback_tag`; the configured deployment hook must switch the host to those images. Before a release, take a verified database backup. Database rollback is a separate reviewed operation: do not blindly reverse additive migrations after new data has been written. Restore to a separate database first, validate it, and make a controlled cutover if needed.

## Exact external blockers

Public hosting is blocked until the owner provides a suitable host/account, accepts any provider cost, supplies domain/DNS control, and configures required sandbox secrets. No public application URL or HTTPS certificate is claimed. Registry publishing, the deployment hook, production environment reviewers and external provider test events require their actual execution. Local container builds and smoke results are recorded separately and never substituted for a public deployment.
