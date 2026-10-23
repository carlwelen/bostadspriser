#!/usr/bin/env bash
# Start Codex as the orchestrator that continues the hardening loop from
# docs/HANDOFF.md. Model mapping from the Claude Code run:
#   orchestrator + reviewers (were Opus)   -> gpt-6-astra
#   implementers B/C/D/E   (were Sonnet)   -> gpt-6.1-sol
#
#   scripts/start-codex.sh            # interactive session
#   scripts/start-codex.sh --exec     # non-interactive (codex exec)
#
# Sandbox: workspace-write plus network (tests need localhost Postgres and the
# Playwright e2e server) and write access to the uv/pnpm caches. If installs or
# tests fail with sandbox permission errors, rerun with SANDBOX=danger-full-access.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="${SANDBOX:-workspace-write}"

read -r -d '' PROMPT <<'EOF' || true
You are the orchestrator continuing an in-progress hardening loop on this repo. Start by reading AGENTS.md, then docs/HANDOFF.md (authoritative state + plan), CLAUDE.md, docs/backlog.md, docs/agent-brief.md and docs/reviewer-brief.md. Follow them exactly.

Models: use gpt-6.1-sol for implementer sub-agents (roles B scraper, C data/API, D map UI, E analytics UI) and gpt-6-astra for reviewer sub-agents (role R, read-only, adversarial, fresh context per review). Run at most 3 sub-agents at a time; give each its own TEST_DB_NAME=bostadspriser_test_<role> and E2E_PORT. If you cannot spawn sub-agents, play the roles sequentially yourself.

First steps, in order:
1. Run scripts/check.sh on main and confirm it is green.
2. Review anything on handoff/b-scraper and handoff/e-analytics that docs/HANDOFF.md marks as not yet (re-)reviewed, using a fresh reviewer per the reviewer brief.
3. Merge in the required order: handoff/b-scraper (B46 first), then handoff/c-data, then handoff/e-analytics, with scripts/merge-seq.sh <sha>... (oldest first; use `git cherry -v main <branch>` to list unmerged commits). Re-run the gate after every merge.
4. Update docs/backlog.md (commit shas, statuses, Orchestration state) after each merge.
5. Continue the plan in docs/HANDOFF.md section 5 until the stop conditions hold, then write docs/REPORT.md.

Do not stop to ask questions; record genuine owner decisions as "BLOCKED: needs owner decision" with a recommendation in docs/backlog.md and keep going. Commit or push only to local branches; do not push to the remote.
EOF

COMMON=(
  -C "$ROOT"
  -m gpt-6-astra
  -c model_reasoning_effort="high"
  -s "$SANDBOX"
  -c sandbox_workspace_write.network_access=true
  --add-dir "$HOME/.cache/uv"
  --add-dir "$HOME/Library/pnpm"
  --add-dir "$HOME/Library/Caches/ms-playwright"
  --enable multi_agent
)

if [[ "${1:-}" == "--exec" ]]; then
  exec codex exec "${COMMON[@]}" "$PROMPT"
else
  exec codex "${COMMON[@]}" -a on-request "$PROMPT"
fi
