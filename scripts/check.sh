#!/usr/bin/env bash
# The gate every change must pass: typecheck, lint, unit, integration, e2e,
# pytest and ruff. Runs against a throwaway test database (never the dev DB).
#
#   scripts/check.sh            # full gate
#   scripts/check.sh --quick    # skip the production build + e2e (NOT the gate)
#
# Env:
#   TEST_DB_NAME   test database name (default bostadspriser_test). Must contain
#                  a "test" segment. Use one per worktree when running in parallel,
#                  e.g. bostadspriser_test_b.
#   E2E_PORT       port for the e2e production server (default 3100).
#   TEST_DATABASE_URL  full override for the test database URL.
#
# Requires a reachable Postgres (`docker compose up -d postgres` or a local one)
# whose user may create databases.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUICK=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

export TEST_DB_NAME="${TEST_DB_NAME:-bostadspriser_test}"
export E2E_PORT="${E2E_PORT:-3100}"

STEP_NAMES=()
STEP_TIMES=()
step() {
  local name="$1"; shift
  printf '\n\033[1m==> %s\033[0m\n' "$name"
  local t0=$SECONDS
  "$@"
  STEP_NAMES+=("$name")
  STEP_TIMES+=("$((SECONDS - t0))s")
}

trap 'printf "\n\033[31mcheck.sh FAILED at step: %s\033[0m\n" "${CURRENT:-?}" >&2' ERR

run() { CURRENT="$1"; step "$@"; }

cd "$ROOT/web"
run "web: prisma generate" pnpm exec prisma generate --no-hints
run "web: typecheck" pnpm exec tsc --noEmit
run "web: lint" pnpm lint
run "test db: reset ($TEST_DB_NAME)" node scripts/test-db.cjs reset
run "web: unit + integration (vitest)" pnpm exec vitest run
if [[ $QUICK -eq 0 ]]; then
  run "web: production build for e2e" pnpm e2e:build
  run "web: e2e (playwright)" pnpm exec playwright test
fi

cd "$ROOT/scraper"
# macOS: Python >= 3.13 ignores .pth files flagged `hidden` (iCloud-synced
# folders set it), which breaks the editable install and the `scraper` CLI.
if [[ "$(uname)" == "Darwin" && -d .venv ]]; then
  find .venv -name '*.pth' -flags +hidden -exec chflags nohidden {} + 2>/dev/null || true
fi
run "scraper: ruff" uv run ruff check
run "scraper: pytest" uv run pytest -q

printf '\n\033[32mcheck.sh passed\033[0m%s\n' "$([[ $QUICK -eq 1 ]] && echo ' (--quick: build + e2e skipped, not the full gate)')"
for i in "${!STEP_NAMES[@]}"; do
  printf '  %-40s %s\n' "${STEP_NAMES[$i]}" "${STEP_TIMES[$i]}"
done
