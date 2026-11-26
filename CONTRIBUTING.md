# Contributing

Create a feature branch from main. Use focused commits that explain the implemented behavior. Open a pull request using the repository template. Do not commit secrets, local .env files, synthetic session tokens, build output, virtual environments, or node_modules.

Before review, run `npm run lint`, `npm run typecheck`, `npm test`, Python pytest and Ruff, `npm run build`, and `npm run test:e2e` with the documented services running. Integration tests require a dedicated database whose name ends in `_test`. Never point tests at a production database.

For migrations, review the SQL, foreign keys, check constraints, query plans, online lock impact, data backfill, restore strategy, and rolling deployment compatibility. Test migration from an empty database and validate a restored backup. Do not edit an already applied migration. Financial and stock fixes must append compensating records; immutable history must be retained.

The repository owner must replace CODEOWNERS' commented team placeholder, create staging/production GitHub environments, require approval for production, protect main with pull requests and required CI checks, disallow force pushes, and assign database reviewers. No review, approval, or remote branch protection is claimed by this local repository.
