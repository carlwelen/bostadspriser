# Independent adversarial review: B36 and B53

Reviewer used detached scratch worktrees at exact e56eb08 and 772ab13; no implementer or main worktree changes. Read AGENTS.md, HANDOFF, CLAUDE, targeted backlog acceptance, and reviewer brief. No live source, Mapbox, external-origin probes, dev database, protected env/state/cache, commit, merge, push, or other-agent processes touched. Probes use owned localhost HTTP servers and isolated PostgreSQL database bostadspriser_test_r_b36. Browser probes use port 3112 with TEST_DB_NAME=bostadspriser_test_r_b53, without requiring a database or the Next app.

## B36 — APPROVE

Commit: e56eb086eb033eec9030c9557ec39f817e99e1dd.

Concrete findings: none. New backlog items: none.

Acceptance: deletion is explicit opt-in; report-only behavior retains known/unknown rows; dry-run reports eligible samples without writes; parser exceptions abort the current batch; eligible known-source IDs are determined under FOR UPDATE and deleted in that same transaction; unknown sources remain untouched; committed mutation batches trigger a refresh and cache notification even on partial failure. No production data was pruned.

Validation (scratch /tmp/review-r-b36):

- `TEST_DB_NAME=bostadspriser_test_r_b36 E2E_PORT=3111 uv run --directory scraper pytest -q tests/test_prune_unparseable.py tests/test_reparse.py tests/test_refresh_view.py`: 52 passed.
- `TEST_DB_NAME=bostadspriser_test_r_b36 E2E_PORT=3111 uv run --directory scraper pytest -q tests/test_review_b36.py`: 3 passed. The independent probes repair raw or change source while the SELECT waits on a row lock, then verify the newer valid/unknown row survives; a separate injected delete failure verifies that valid-row updates roll back together with deletions and no commit callback fires.
- `TEST_DB_NAME=bostadspriser_test_r_b36 E2E_PORT=3111 uv run --directory scraper pytest -q`: 762 passed (759 repository tests plus 3 reviewer cases), 50.50 seconds.
- `uv run ruff check src/scraper/reparse.py src/scraper/run.py tests/test_prune_unparseable.py`: passed.

Fail-without-fix: YES. `git checkout e56eb08~1 -- scraper/src/scraper/reparse.py scraper/src/scraper/run.py`, then the same environment with `uv run --directory scraper pytest -q tests/test_prune_unparseable.py`: 18 failures due to absent prune CLI/API/summary support. Restored both source files from e56eb08 before the full passing suite. The feature failures are expected missing-capability failures; meaningful SQL deletion, locking, rollback, refresh, notification, idempotence, unknown-source retention, and dry-run assertions all execute successfully with the fix.

Evidence: b36-reverted.log, b36-probes.log, b36-all.log.

## B53 — APPROVE

Cumulative commits: 6a2de79d8b88c1b46055ea5173c8621a9f8733c5, 7ef637d813aeedf1447c70114d4a2fe73e06243f, 772ab1339c0eac6f644a92ea01bc34f98ea50a52.

Concrete findings: none. New backlog items: none.

Acceptance: auto fixture guards tests that do not request consoleErrors; exact-origin comparison blocks a different port sharing the app URL prefix. The localhost proxy enforces the same origin when browser redirects bypass Playwright interception. Allowed redirects preserve URL, method and body. Latest response error/incomplete-close listeners make Content-Length-truncated responses reject. Independent chunked-body truncation, CONNECT/upgrade rejection, proxy teardown with an active upstream, and client-disconnect cleanup all pass.

Validation (scratch /tmp/review-r-b53):

- Owned-localhost runner: `TEST_DB_NAME=bostadspriser_test_r_b53 E2E_PORT=3112 pnpm --dir web exec playwright test -c playwright.review.config.ts network-boundary.spec.ts network-redirect.spec.ts network-abort.spec.ts`: 16 passed across desktop and Pixel 7.
- Same command plus `review-proxy.spec.ts review-abort.spec.ts`: 24 passed, 5.9 seconds.
- `pnpm exec tsc --noEmit` and `pnpm exec eslint e2e/fixtures.ts e2e/originProxy.ts e2e/network-abort.spec.ts e2e/network-redirect.spec.ts e2e/network-boundary.spec.ts`: passed.
- This review intentionally used only the small owned-localhost server; it did not rerun the complete production-app full gate already recorded for the patch.

Fail-without-fix: YES for all three changes:

1. `git checkout 6a2de79~1 -- web/e2e/fixtures.ts`; run network-boundary.spec.ts with the runner above: 4 failures. Local receiver gets requests that should be blocked, including the shared origin-prefix port.
2. `git checkout 6a2de79 -- web/e2e/fixtures.ts`; run network-redirect.spec.ts: 8 failures because fetch/direct/popup redirects reach the other local origin; the 2 allowed same-origin redirect tests still pass.
3. With latest fixtures, `git checkout 7ef637d -- web/e2e/originProxy.ts`; run network-abort.spec.ts: 2 failures, expected "rejected", received "pending" after 3 seconds.

Restored fixtures and proxy from 772ab13 before the final 24-check pass.

Evidence: b53-fixed.log, b53-boundary-reverted.log, b53-redirect-reverted.log, b53-abort-reverted.log, b53-final.log.

## Reviewer probe code

### test_review_b36.py

```python
"""Independent B36 concurrency/atomicity probes; isolated test database only."""
import importlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from scraper import hemnet
from scraper.db import upsert_listing
from tests.test_prune_unparseable import seed_invalid, ids
from tests.test_reparse import HEMNET_CARD

module = importlib.import_module("scraper.reparse")


@pytest.mark.parametrize("repair", ["raw", "source"])
def test_locked_select_rechecks_a_concurrently_repaired_row(db, repair):
    row_id = seed_invalid()
    # Reflect before the other transaction takes its row lock.
    module.listing_table()
    selecting = Event()

    def before_execute(conn, cursor, statement, parameters, context, many):
        if 'FOR UPDATE' in statement:
            selecting.set()

    event.listen(db, "before_cursor_execute", before_execute)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with db.connect() as conn:
                transaction = conn.begin()
                if repair == "raw":
                    conn.execute(text('UPDATE "Listing" SET raw = CAST(:raw AS jsonb) WHERE id = :id'),
                                 {"id": row_id, "raw": json.dumps(HEMNET_CARD)})
                else:
                    conn.execute(text('UPDATE "Listing" SET source = :source WHERE id = :id'),
                                 {"id": row_id, "source": "future-source"})
                task = pool.submit(module.reparse, prune_unparseable=True)
                try:
                    assert selecting.wait(5), "reparse never reached locked read"
                finally:
                    transaction.commit()
                result = task.result(timeout=10)
        assert result.pruned == 0
        assert ids(db) == {row_id}
        assert result.unparseable == (1 if repair == "source" else 0)
    finally:
        event.remove(db, "before_cursor_execute", before_execute)


def test_update_and_delete_rollback_together_if_delete_fails(db, monkeypatch):
    invalid = seed_invalid()
    valid = hemnet._to_row({**HEMNET_CARD, "listingId": "valid"}, "ostermalm")
    valid["street"] = "Legacy"
    upsert_listing(valid)
    original = Session.execute
    commits = []

    def reject_delete(self, statement, *args, **kwargs):
        if getattr(statement, "is_delete", False):
            raise RuntimeError("injected delete failure")
        return original(self, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "execute", reject_delete)
    with pytest.raises(RuntimeError, match="injected delete failure"):
        module.reparse(prune_unparseable=True, on_commit=lambda: commits.append(True))
    assert commits == []
    assert ids(db) == {invalid, valid["id"]}
    with db.connect() as conn:
        assert conn.execute(text('SELECT street FROM "Listing" WHERE id = :id'), {"id": valid["id"]}).scalar_one() == "Legacy"

```

### review-proxy.spec.ts

```typescript
import { createServer, request, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { originProxy } from "./originProxy";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
function rawAttempt(proxy: string, message: string) {
  return new Promise<string>((resolve, reject) => {
    const url = new URL(proxy);
    let reply = "";
    const socket = connect(Number(url.port), url.hostname, () => socket.end(message));
    socket.on("data", (chunk) => { reply += chunk; });
    socket.on("error", (error: NodeJS.ErrnoException) => error.code === "ECONNRESET" ? resolve(reply) : reject(error));
    socket.on("close", () => resolve(reply));
  });
}

test("transport rejects HTTP destinations, CONNECT tunnels and upgrades before reaching a receiver", async () => {
  let received = 0;
  const app = createServer((_req, res) => { received += 1; res.end("ok"); });
  const other = createServer((_req, res) => { received += 1; res.end("bad"); });
  const origin = await listen(app);
  const target = await listen(other);
  const proxy = await originProxy(origin);
  try {
    await rawAttempt(proxy.options.server, `GET ${target}/escape HTTP/1.1\r\nHost: ${new URL(origin).host}\r\nConnection: close\r\n\r\n`);
    await rawAttempt(proxy.options.server, `CONNECT ${new URL(target).host} HTTP/1.1\r\nHost: ${new URL(target).host}\r\n\r\n`);
    await rawAttempt(proxy.options.server, `GET ${origin}/ws HTTP/1.1\r\nHost: ${new URL(origin).host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    expect(received).toBe(0);
  } finally {
    await proxy.close();
    await Promise.all([stop(app), stop(other)]);
  }
});

test("proxy close releases an in-flight upstream response and its client", async () => {
  let upstreamClosed!: () => void;
  let upstreamStarted!: () => void;
  const closed = new Promise<void>((resolve) => { upstreamClosed = resolve; });
  const started = new Promise<void>((resolve) => { upstreamStarted = resolve; });
  const app = createServer((_req, res) => {
    res.on("close", upstreamClosed);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("unfinished");
    upstreamStarted();
  });
  const origin = await listen(app);
  const proxy = await originProxy(origin);
  const client = request(proxy.options.server, { path: `${origin}/pending` });
  const done = new Promise<void>((resolve) => {
    client.on("error", () => resolve());
    client.on("response", (response) => {
      response.on("error", () => resolve());
      response.on("close", () => resolve());
      response.resume();
    });
  });
  client.end();
  try {
    await started;
    await proxy.close();
    await Promise.all([closed, done]);
  } finally {
    client.destroy();
    await stop(app);
  }
});

test("a client disconnect releases the upstream response", async () => {
  let upstreamClosed!: () => void;
  const closed = new Promise<void>((resolve) => { upstreamClosed = resolve; });
  const app = createServer((_req, res) => {
    res.on("close", upstreamClosed);
    res.write("unfinished");
  });
  const origin = await listen(app);
  const proxy = await originProxy(origin);
  const client = request(proxy.options.server, { path: `${origin}/pending` });
  client.on("error", () => {});
  client.on("response", (response) => {
    response.on("error", () => {});
    client.destroy();
  });
  client.end();
  try { await closed; } finally {
    client.destroy();
    await proxy.close();
    await stop(app);
  }
});

```

### review-abort.spec.ts

```typescript
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test as base, expect } from "./fixtures";

const test = base.extend<{ app: string }>({
  app: async ({}, provide) => {
    const server = createServer((request, response) => {
      if (request.url === "/abort") {
        response.writeHead(200, { "Transfer-Encoding": "chunked" });
        response.write("short");
        setTimeout(() => response.destroy(), 30);
      } else {
        response.setHeader("Content-Type", "text/html");
        response.end("<html>Owned local server</html>");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await provide(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  },
  baseURL: async ({ app }, provide) => provide(app),
});

test("review: interrupted chunked upstream body rejects", async ({ page }) => {
  await page.goto("/");
  const outcome = await page.evaluate(() => Promise.race([
    fetch("/abort").then((response) => response.text()).then(() => "complete", () => "rejected"),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 3000)),
  ]));
  expect(outcome).toBe("rejected");
});

```

### playwright.review.config.ts

```typescript
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e", workers: 1, retries: 0, timeout: 15000,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3112" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "node review-server.cjs", url: "http://127.0.0.1:3112", reuseExistingServer: false },
});

```

### review-server.cjs

```javascript
const server = require("node:http").createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<html>Owned reviewer localhost</html>"); });
server.listen(3112, "127.0.0.1");

```

