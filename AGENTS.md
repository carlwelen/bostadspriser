# AGENTS.md

Instructions for coding agents such as Codex working in this repository.

1. **Start with `docs/HANDOFF.md`.** It says exactly what is merged, which reviewed commits wait on `handoff/*` branches, the merge order, and what is left.
2. **Project conventions and commands** are in `CLAUDE.md`. They apply to every agent, not only Claude.
3. **Work queue and status** live in `docs/backlog.md`, the single source of truth. Update it as you go.
4. **The per-task loop** is in `docs/agent-brief.md`: write a failing test first, make the smallest fix, run `scripts/check.sh` until it's fully green, then make one commit per backlog ID. Adversarial review uses `docs/reviewer-brief.md`.
5. **Gate:** run `scripts/check.sh` before every commit and after every merge. Merge reviewed commits with `scripts/merge-seq.sh <sha>…`.

Hard rules (details in `docs/HANDOFF.md` §4):
- Never run the live scrapers against hemnet.se or booli.se.
- Never strengthen bot-protection circumvention.
- Never touch `.env`, `scraper/.state/` or `scraper/.cache/`.
- Never run destructive SQL against the dev DB `bostadspriser`. Tests use `bostadspriser_test*` databases only.
- Never kill processes you didn't start.
- UI copy is Swedish; code, comments and commits are English.
