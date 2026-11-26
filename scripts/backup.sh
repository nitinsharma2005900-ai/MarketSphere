#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime/backups
backup=".runtime/backups/marketsphere-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres pg_dump -U marketsphere -d marketsphere -Fc > "$backup"
test -s "$backup"
printf 'Created %s\n' "$backup"
