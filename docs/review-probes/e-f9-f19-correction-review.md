# Fresh F9/F19 correction review — 8001be3

**F9: APPROVE. F19 (E analytics scope): APPROVE.** No confirmed blocker, major, minor, or nit product findings remain in this cumulative batch. No new product backlog item is required.

Reviewed immutable `8001be3` in detached `/tmp/review-e-corrections2`, cumulative base `011bd0d`: F9 `7dfd56d` + `a2009cd`, F19 `fb05162` + `8001be3`. Main and implementer checkouts were read-only. Every test used `TEST_DB_NAME=bostadspriser_test_r_e2 E2E_PORT=3116`; no live scrapers/Mapbox, protected files, dev database, commits, pushes, or unrelated processes were touched.

## Current acceptance evidence

- `pnpm test:unit`: **195 passed**, including comparison parsing/dedupe/explicit empty state, shared analytics error/loading contracts, and annual district entry link. Production `pnpm e2e:build` passed typechecking/lint/build.
- `pnpm test:e2e e2e/compare-navigation.spec.ts e2e/reviewer-e2-extra.spec.ts`: **26 passed** across desktop and Pixel 7, using the preserved exact-origin buffered proxy. This covers all three original builder tests, stale active index after preset selection, initial ArrowUp, composing Enter, both annual entry links, delayed additions, modified and middle-click new tabs, same-URL granularity navigation followed by selection/back/forward, empty matches/Escape/composing arrows, and delayed removal with competing chip/preset clicks. Pending serialization guards both add and remove flows; afterward another mutation succeeds.
- `node tests/ui/analytics-failure-probe.mjs`: **10 passed**, desktop/mobile × insights, compare, district, street, house. A real test-DB materialized-view rename caused the public error UI; restoring the view then clicking the actual retry button rendered the healthy heading and removed the error. Each exact URL remained unchanged, including selected series, annual granularity, and room filters. Raw DB relation/Prisma details were absent from the rendered body. The street ancestor-layout failure is covered.
- Inspected regenerated mobile comparison recovery and desktop street error screenshots; layout and Swedish copy are intact. Shared chart/chip colors follow the same palette in source.

## Regression sensitivity: production-only correction reversion

In scratch, retained all current tests and restored the changed production implementations to `fb05162`: `CompareBuilder.tsx`, compare page, district page, street overview page, `AnalyticsError.tsx`, and the six analytics error boundary modules. Left the unused new navigation module present so only runtime-used production implementations changed. Rebuilt successfully with `pnpm e2e:build`.

- `pnpm test:unit comparison.test.tsx`: **1 expected failure**; old district comparison href omits `g=year`.
- `pnpm test:e2e e2e/compare-navigation.spec.ts --project=desktop`: **5 expected failures, 1 pass**. The stale-option case throws `Cannot read properties of undefined (reading 'id')`; initial ArrowUp selects the wrong option; both annual links lose `g=year`; delayed addition leaves the picker enabled. The already-correct IME guard still passes. The buffered proxy retains the deliberate four-second navigation delay, so serialization coverage remains meaningful.
- `node tests/ui/analytics-failure-probe.mjs`: **10 expected failures**, all five routes on both viewports remain on their error boundary after restoration/retry. Thus the probe proves actual recovery, not merely a fetch or reset call. The same probe passed all ten cases on the reviewed build.

The test view was restored after the failed runs. A final guarded query returned database `bostadspriser_test_r_e2`, `DedupedListingMat` present, and no `AnalyticsProbeUnavailable` view.

## Test-harness qualification

The original streaming proxy produced intermittent pending navigation failures while Chromium recorded `net::ERR_ABORTED` for complete healthy upstream RSC payloads. No product regression was confirmed from those failures. The repeatable 26-test pass and five-case reversion failure use the saved proxy, which requests identity encoding, buffers RSC bytes without decoding, applies latency only to non-prefetch RSC requests, and avoids destroying a successfully completed upstream response. It still refuses every other origin and rejects CONNECT/upgrades. This is test-only evidence, not a proposed application change. A shared harness stability follow-up may be useful; do not treat isolated streaming-proxy timeouts as a demonstrated picker bug.

Two initial extra-probe errors were corrected: an ambiguous unnamed combobox locator and a physical click near the sticky header during viewport scrolling. The final probe names the picker and limits competing removal clicks to visible chip/preset targets; the committed addition probe separately covers granularity contention.

## Reproduction and artifacts

From a fresh detached checkout of `8001be3`, install frozen web dependencies, copy `reviewer-e2-extra.spec.ts` to `web/e2e/` and the supplied `originProxy.ts` to `web/tests/ui/`. Export the DB/port above, run `pnpm e2e:build`, then the browser command above (which seeds the test DB), then the recovery probe alone. Run with `AGG_CACHE=off` for failure probes; the committed recovery script also sets that on its isolated server. The proxy and probe source below are the exact exercised scratch versions, including diagnostic logging.

All logs, regression traces, sources, and F19 screenshots are in `/tmp/review-e2-artifacts/`. Principal logs: `review-e2-unit.log`, `review-e2-build.log`, `review-e2-buffered-browser.log`, `review-e2-recovery.log`, `review-e2-unit-reversion.log`, `review-e2-f9-reversion.log`, `review-e2-f19-reversion.log`. No full gate rerun was needed for this read-only review. The scratch worktree was removed after preserving evidence.

## Extra probe source

```ts
import { expect, test as base } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { originProxy } from '../tests/ui/originProxy';
const test = base.extend<{consoleErrors:string[]}>({
 proxy: async ({baseURL}, provide, info) => {
  const proxy = await originProxy(new URL(baseURL!).origin, info.title.includes('pending removal'));
  try { await provide(proxy.options); } finally { await proxy.close(); }
 },
 serviceWorkers: 'block',
 consoleErrors: async ({page}, provide) => {
  const errors:string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
  await provide(errors);
 },
});

test("builds a comparison with streets and districts by keyboard and can remove every series", async ({ page }) => {
  test.setTimeout(15000);
  await page.goto("/compare?series=district:ostermalm&g=year");
  const search = page.getByRole("combobox", { name: "Lägg till gata eller stadsdel" });
  await search.fill("gotgatan");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/street%3Asodermalm%2Fgotgatan/);
  await expect(page).toHaveURL(/g=year/);
  const selected = page.getByRole("group", { name: "Valda serier" });
  await expect(selected.getByRole("link", { name: "Ta bort Götgatan (Södermalm)" })).toBeVisible();
  await search.fill("Vasastan");
  await page.getByRole("option", { name: "Vasastan", exact: true }).click();
  await expect(selected.getByRole("link")).toHaveCount(3);
  await selected.getByRole("link", { name: "Ta bort Östermalm", exact: true }).click();
  await selected.getByRole("link", { name: "Ta bort Götgatan (Södermalm)", exact: true }).click();
  await selected.getByRole("link", { name: "Ta bort Vasastan", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inga serier valda");
  await expect(page).toHaveURL(/series=&g=year/);
  await expect(selected.getByRole("link")).toHaveCount(0);
});

test("deduplicates repeated and comma-separated series and rejects malformed street paths", async ({ page, consoleErrors }) => {
  await page.goto("/compare?series=district:ostermalm,district:ostermalm&series=street:sodermalm/gotgatan&series=street:sodermalm/gotgatan/extra");
  const selected = page.getByRole("group", { name: "Valda serier" });
  await expect(selected.getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Östermalm vs Götgatan (Södermalm)");
  expect(consoleErrors).toEqual([]);
});

test("street chart offers a comparison link", async ({ page }) => {
  await page.goto("/street/sodermalm/gotgatan");
  await page.getByRole("link", { name: "Jämför →", exact: true }).click();
  await expect(page).toHaveURL(/series=street/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Götgatan (Södermalm)");
});


test.beforeEach(async ({page},info) => {
 page.on('pageerror', e=>console.log('PAGEERROR', e.message));
 page.on('console', m=> { if(m.type()==='error')console.log('CONSOLE',m.text()); });
 page.on('response',async r=> { if(r.url().includes('_rsc')) { try {const data=await r.body(); console.log('RSC',r.status(),r.url(),data.length);writeFileSync('/tmp/review-e2-'+info.project.name+'-'+info.title.slice(0,15).replaceAll(' ','_')+'-rsc.txt',data);}catch(e){console.log('RSC READ ERROR',String(e));} } });
});

test('same-granularity navigation releases its lock for another selection', async ({page, consoleErrors}) => {
 await page.goto('/compare?series=&g=year');
 await page.waitForTimeout(1000);
 await page.getByRole('group',{name:'Tidsupplösning'}).getByRole('link',{name:'År',exact:true}).click();
 const input = page.getByRole('combobox',{name:'Lägg till gata eller stadsdel'});
 await expect(input).toBeEnabled({timeout:15000});
 await page.waitForTimeout(1000);
 await input.fill('Vasastan');
 await input.press('Enter');
 await expect(page.getByRole('group',{name:'Valda serier'}).getByRole('link')).toHaveCount(1);
 await page.goBack();
 await expect(page.getByRole('heading',{level:1})).toHaveText('Inga serier valda');
 await page.goForward();
 await expect(page.getByRole('heading',{level:1})).toHaveText('Vasastan');
 expect(consoleErrors).toEqual([]);
});

test('native modified and middle clicks retain new-tab behavior', async ({page,context,consoleErrors}) => {
 await page.goto('/compare?series=district:vasastan&g=year');
 const original = page.url();
 for(const method of ['modified','middle'] as const) {
  const popup = context.waitForEvent('page');
  const link = page.getByRole('region',{name:'Snabbval'}).getByRole('link',{name:'Östermalm',exact:true});
  if(method==='modified') await link.click({modifiers:['ControlOrMeta']});
  else await link.click({button:'middle'});
  const opened = await popup;
  await expect(opened.getByRole('heading',{level:1})).toHaveText('Vasastan vs Östermalm');
  await expect(opened).toHaveURL(/g=year/);
  await expect(page).toHaveURL(original);
  await opened.close();
 }
 expect(consoleErrors).toEqual([]);
});

test('empty matches, escape, and composing navigation keys do not select', async ({page,consoleErrors}) => {
 await page.goto('/compare?series=');
 const input=page.getByRole('combobox',{name:'Lägg till gata eller stadsdel'});
 await input.fill('missing street 9999');
 await input.press('ArrowUp');
 await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
 await input.press('Enter');
 await expect(page).toHaveURL(/series=$/);
 await input.fill('sodermalm');
 await expect(page.getByRole('option',{name:'Södermalm',exact:true})).toBeVisible();
 await input.dispatchEvent('keydown',{key:'ArrowDown',isComposing:true,bubbles:true});
 await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true});
 await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
 await input.press('Escape');
 await input.press('Enter');
 await expect(page).toHaveURL(/series=$/);
 await expect(page.getByRole('group',{name:'Valda serier'}).getByRole('link')).toHaveCount(0);
 expect(consoleErrors).toEqual([]);
});

test('pending removal blocks stale chip, preset, and granularity mutations', async ({page,consoleErrors}) => {
 await page.goto('/compare?series=district:vasastan,district:ostermalm');
 await page.getByRole('link',{name:'Ta bort Östermalm',exact:true}).click({noWaitAfter:true});
 const input=page.getByRole('combobox',{name:'Lägg till gata eller stadsdel'});
 await expect(input).toBeDisabled();
 for(const link of [page.getByRole('link',{name:'Ta bort Vasastan',exact:true}), page.getByRole('region',{name:'Snabbval'}).getByRole('link',{name:'Norrmalm',exact:true})]) {
  await link.scrollIntoViewIfNeeded();
  const b=(await link.boundingBox())!;
  await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
 }
 await expect(input).toBeEnabled({timeout:15000});
 await expect(page.getByRole('heading',{level:1})).toHaveText('Vasastan');
 await expect(page).not.toHaveURL(/g=year/);
 await page.getByRole('link',{name:'Ta bort Vasastan',exact:true}).click();
 await expect(page.getByRole('heading',{level:1})).toHaveText('Inga serier valda');
 expect(consoleErrors).toEqual([]);
});

```

## Exact-origin proxy source

```ts
import { writeFileSync } from "node:fs";
import { createServer, request, type ClientRequest } from "node:http";
import type { AddressInfo } from "node:net";

/** Browser redirects bypass Playwright routes; enforce the origin at the transport too. */
export async function originProxy(origin: string, delayComparison = false) {
  if (new URL(origin).protocol !== "http:") throw new Error("The e2e app must use local HTTP");
  const pending = new Set<ClientRequest>();
  const server = createServer(async (incoming, outgoing) => {
    let destination: URL;
    try {
      destination = new URL(incoming.url ?? "");
    } catch {
      outgoing.destroy();
      return;
    }
    if (destination.origin !== origin) {
      outgoing.destroy();
      return;
    }
    if (delayComparison && !incoming.headers['next-router-prefetch'] && destination.searchParams.get('series') === 'district:vasastan' && destination.searchParams.has('_rsc')) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    const upstream = request(destination, {
      method: incoming.method,
      headers: { ...incoming.headers, host: destination.host, "accept-encoding": "identity" },
    }, (response) => {
      const chunks:Buffer[]=[];
      if(destination.searchParams.has('_rsc') && destination.pathname==='/compare') {
        response.on('data',chunk=>chunks.push(Buffer.from(chunk)));
        response.on('end',()=> {console.log('WIRE END', destination.href, Buffer.concat(chunks).length);writeFileSync('/tmp/e2-wire-'+Date.now()+'.gz', Buffer.concat(chunks));});
        response.on('error',e=>console.log('WIRE ERROR',destination.href,String(e)));
        response.on('close',()=>console.log('WIRE CLOSE',destination.href,response.complete));
      }
      response.once("error", () => outgoing.destroy());
      response.once("close", () => {
        if (!response.complete) outgoing.destroy();
      });
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      if (destination.searchParams.has('_rsc')) {
      const buffers:Buffer[]=[];
      response.on('data', chunk=>buffers.push(Buffer.from(chunk)));
      response.once('end',()=>outgoing.end(Buffer.concat(buffers)));
    } else response.pipe(outgoing);
    });
    pending.add(upstream);
    upstream.once("close", () => pending.delete(upstream));
    upstream.once("error", () => outgoing.destroy());
    incoming.once("aborted", () => upstream.destroy());
    outgoing.once("close", () => { if (!outgoing.writableFinished) upstream.destroy(); });
    incoming.pipe(upstream);
  });
  // The app is HTTP. Reject tunnels and upgrades before opening any connection.
  server.on("connect", (_request, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    // Chromium normally bypasses proxies for loopback; explicitly remove that bypass.
    options: { server: `http://127.0.0.1:${port}`, bypass: "<-loopback>" },
    async close() {
      for (const upstream of pending) upstream.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

```
