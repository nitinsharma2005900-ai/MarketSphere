# Contributing

Create a feature branch from main. Use focused commits that explain the implemented behavior. Open a pull request using the repository template. Do not commit secrets, local .env files, synthetic session tokens, build output, virtual environments, or node_modules.

Before review, run `npm run lint`, `npm run typecheck`, `npm test`, Python pytest and Ruff, `npm run build`, and `npm run test:e2e` with the documented services running. Integration tests require a dedicated database whose name ends in `_test`. Never point tests at a production database.

For migrations, review the SQL, foreign keys, check constraints, query plans, online lock impact, data backfill, restore strategy, and rolling deployment compatibility. Test migration from an empty database and validate a restored backup. Do not edit an already applied migration. Financial and stock fixes must append compensating records; immutable history must be retained.

CODEOWNERS names the actual repository owner. Add an independent database reviewer/team, create staging/production GitHub environments, require approval for production, protect main with pull requests and required CI checks, and disallow force pushes. The branch-protection API returned HTTP 403 for this private repository: GitHub requires a supporting plan or a visibility change. The repository stays private; no billing or visibility change was made. Human review and approval are not fabricated. The exact response is retained in docs/evidence/branch-protection-result.txt.
