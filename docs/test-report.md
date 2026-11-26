# Actual test execution report

Generated 26 November 2026, 14:29 IST from retained machine-readable reports.

| Suite | Actual result | Evidence |
|---|---|---|
| Vitest / Supertest / React Testing Library | 30 passed; 0 failed | evidence/vitest-results.json and XML |
| Pytest / HTTPX | 13 tests; 0 failures/errors | evidence/python-results.xml |
| Playwright Chromium | 6 passed; 0 unexpected failures | evidence/playwright-results.json; screenshots/ |
| Selected JS statement coverage | 70.23% | evidence/coverage/coverage-summary.json |
| Selected JS line coverage | 71.39% | evidence/coverage/coverage-summary.json |
| Python line coverage | 95.38% | evidence/python-coverage.json |
| Build / static checks | 4 of 4 recorded checks pass | evidence/build-results.json and checks/ |

The inventory/payment/refund capstone uses real PostgreSQL and signed HTTP events. `capstone.json` records concurrent request statuses, inventory/ledger consistency, replay counts, financial reversals and a real PostgreSQL EXPLAIN plan. Local MinIO and Mailpit adapters are exercised when configured. Optional external Stripe/hosting operations are not included in local pass counts. Browser tests cover product discovery, filtering, SKU choice, mobile overflow, customer checkout/support and all five role logins.

GitHub quality workflow snapshot: status **completed**, conclusion **failure**. Actual run: https://github.com/nitinsharma2005900-ai/MarketSphere/actions/runs/45786819534. Local adapter checks are explicitly skipped in CI when MinIO/Mailpit are not configured. Additional read-only portal route checks are recorded in portal-smoke.json.

Coverage is for the configured selected API modules and UI status components; Playwright executes additional browser code outside Vitest coverage. It is not a claim of exhaustive coverage. The Python environment reports a Starlette/httpx TestClient deprecation warning; its tests still execute. Raw test results retain actual durations and outcomes. See incident-rca.md for the serialization retry defect found and fixed by the initial capstone run.
