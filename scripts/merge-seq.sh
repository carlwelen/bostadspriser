#!/usr/bin/env bash
# Cherry-pick commits onto main one at a time; full gate after each.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
for sha in "$@"; do
  echo "=== merging $sha: $(git log -1 --format=%s "$sha")"
  if ! git cherry-pick -x "$sha" >/tmp/merge-$sha.log 2>&1; then
    echo "CHERRY-PICK CONFLICT at $sha"; cat /tmp/merge-$sha.log; git cherry-pick --abort; exit 1
  fi
  if ! scripts/check.sh >/tmp/check-$sha.log 2>&1; then
    echo "GATE FAILED after $sha (log /tmp/check-$sha.log)"; tail -40 /tmp/check-$sha.log; exit 1
  fi
  echo "gate green after $sha -> $(git rev-parse --short HEAD)"
  tail -12 /tmp/check-$sha.log | grep -E "^\s+(web|scraper|test db)" 
done
echo ALL MERGED
