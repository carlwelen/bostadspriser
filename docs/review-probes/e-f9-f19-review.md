Fresh adversarial review of `7dfd56d` (F9) and `fb05162` (F19)

Reviewed in detached `/tmp/review-e-f9-f19` at fb05162. Only that scratch worktree was changed. Test database: `bostadspriser_test_r_e_f9`; port: 3113. No live scraping/Mapbox, protected files, dev database, commits, merges, pushes, or unrelated processes were touched.

**F9 — CHANGES REQUESTED**

1. **Major — stale active option crashes keyboard selection.** `web/src/components/CompareBuilder.tsx:47` indexes `matches[active]` without keeping `active` within the new matches. `add()` then dereferences undefined at line 29. Production reproduction: open `/compare?series=`, focus the picker, ArrowDown to the final option (16 options in the fixture), Tab out, click the Östermalm quick preset, refocus the picker, Enter. The preset removes one option but keeps active=15; the new array has length15. Browser reports `Cannot read properties of undefined (reading 'id')`, and no second series is added. Reset/reconcile active selection when matches or selected IDs change, and guard the final lookup. Evidence: `/tmp/review-e-f9-f19-proxy.log`, `/tmp/review-e-f9-f19-proxy-results/`.

2. **Major — overlapping additions are computed from stale selections.** `web/src/components/CompareBuilder.tsx:20` and `:29` derive each push exclusively from server-provided selected IDs and offer no pending/optimistic state. With the Vasastan navigation delayed4seconds, keyboard-select Vasastan then type/select Götgatan before it completes. The browser sends separate `series=district:vasastan` and `series=street:sodermalm/gotgatan` requests; neither includes both. The Götgatan response arrives in18ms, the first response after4seconds, but the rendered page remains at the empty selection. This was reproduced with real `page.keyboard` events through a byte-preserving exact-origin proxy, not synthetic DOM events or per-request Playwright routing. Accumulate pending selections or disable/serialize every selection mutation until navigation commits; cover out-of-order responses. Evidence: `/tmp/review-e-f9-overlap-keyboard.log` and `/tmp/review-e-f9-overlap-keyboard-results/`. A slower locator-level `press()` can mask this race by waiting through navigation; use the supplied direct-keyboard probe.

3. **Minor — initial ArrowUp skips the final option.** `web/src/components/CompareBuilder.tsx:45`: from active=-1, the formula yields length-2. In the16-option fixture ArrowUp highlights Surbrunnsgatan instead of final Vasagatan. Handle the unopened/unselected starting position explicitly. Evidence: `/tmp/review-e-f9-f19-proxy.log`.

4. **Minor — new comparison entry link discards annual granularity.** `web/src/app/street/[district]/[street]/(overview)/page.tsx:108`: `/street/sodermalm/gotgatan?g=year` → Jämför → `/compare?series=street:sodermalm/gotgatan`, now monthly. Use `comparisonHref([id], granularity)`. The probe waits for the compare pathname before checking g, so it cannot accidentally pass against the old street URL. Evidence: `/tmp/review-e-f9-final-extra.log`.

**F19 — CHANGES REQUESTED**

1. **Major — retry fetches healthy server data but never recovers the boundary.** `web/src/components/AnalyticsError.tsx:18` calls `router.refresh(); reset();` synchronously. In the isolated production server with AGG_CACHE=off, rename the test database's DedupedListingMat, load any analytics route, then restore the name and click Försök igen. All five routes (insights, compare, district, street, house) stay on their Swedish error screen after the successful RSC response. A full reload immediately renders each healthy page at the same URL. The parent street layout failure is included. Refresh/reset must be sequenced so the reset uses the refreshed tree; a reload of the current URL is also a proven recovery that preserves filters. Add a real transient-failure production test; the supplied commit probe only checks that an RSC request occurs while the DB remains unavailable, so it cannot catch this failure.

Evidence: `/tmp/review-e-f9-f19-proxy.log`, `/tmp/review-e-f9-f19-proxy-results/`, and `/tmp/review-f19-{insights,compare,district,street,house}-rsc.txt`. Every captured RSC payload contains the correct healthy heading/data and no `:E{` error record. Playwright's text capture displays these text/x-component responses with UTF-8-as-Windows-1252 mojibake; matching `heading.encode('utf8').decode('cp1252')` confirms each heading. The failure reproduces without any Playwright route interception. A full reload is explicitly asserted and passes for all five routes. URL selection parameters remain unchanged, and neither raw relation names nor Prisma error details appear in the rendered error body.

**Checks and regression sensitivity**

- `TEST_DB_NAME=bostadspriser_test_r_e_f9 E2E_PORT=3113 pnpm test:unit`:194 tests passed, including the five new pure/component tests. The F19 unit test verifies refresh/reset calls but cannot prove recovery.
- `TEST_DB_NAME=bostadspriser_test_r_e_f9 E2E_PORT=3113 pnpm e2e:build`:passed on fb05162.
- `TEST_DB_NAME=bostadspriser_test_r_e_f9 E2E_PORT=3113 AGG_CACHE=off pnpm test:e2e e2e/compare-builder.spec.ts --project=desktop`:all3 commit tests passed (run as part of the combined13-test invocation).
- Standard composing Enter is correctly ignored. Repeated/comma-separated series deduplicate; malformed extra path segments are rejected; explicit empty selection remains empty. Shared chip/chart colors use the same palette.
- Extra browser probes and the transport proxy are preserved at `/tmp/reviewer-f9-f19.spec.ts` and `/tmp/reviewer-originProxy.ts`. Copy them into web/e2e, then run with the environment above. The proxy denies every non-app origin; its only deliberate delay is the Vasastan RSC request in the overlapping-additions test.
- Production reversion: `git restore --source=7dfd56d^ -- web/src` in scratch (including the newly introduced colocated unit modules so they do not prevent compiling a parent production build). The new Playwright tests and reviewer probes were retained. Built `.next-reverted` with `NEXT_DIST_DIR=.next-reverted NEXT_PUBLIC_MAPBOX_TOKEN= pnpm exec next build`; the scratch config passes NEXT_DIST_DIR through, and tsconfig excludes that build directory exactly as it already excludes .next-e2e. Reversion command: `TEST_DB_NAME=bostadspriser_test_r_e_f9 E2E_PORT=3113 AGG_CACHE=off NEXT_DIST_DIR=.next-reverted pnpm test:e2e e2e/compare-builder.spec.ts e2e/reviewer-f9-f19.spec.ts --project=desktop --timeout=10000 --grep 'builds a comparison|deduplicates repeated|street chart offers|recovers from'`. See `/tmp/review-e-f9-f19-reversion.log` for8 expected failures: missing builder/chips/Jämför link and missing Swedish fallback boundaries.

**Scope / proposed separate backlog work**

- Fix the two major picker defects under F9, and recovery under F19. The minor new-picker defects can be included in the F9 follow-up.
- Suggested new ID **F41 (P2)**, subject to the orchestrator's next-free-ID check: preserve selected granularity consistently across existing analytics comparison-entry links. The district Jämför link already had the same g-loss before these commits; that older path should be tracked separately if not included by explicit scope. No unrelated implementation change is required for this review.
- No full gate was rerun: this was a focused read-only review, with the complete unit suite, a production build, production browser probes, and a parent-production reversion. Mobile/error screenshots already supplied by the commits were not rerendered by this review. The recovery and picker flaws reproduce on desktop without dependence on viewport.

Probe sources follow so they survive scratch-worktree cleanup.

reviewer-f9-f19.spec.ts

```ts
import { expect, test as base } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from '../scripts/test-db.cjs';
import {writeFileSync} from 'node:fs';
import {originProxy} from './reviewer-originProxy';

const test = base.extend({
  proxy: async ({baseURL}, use, testInfo) => {
    const proxy = await originProxy(new URL(baseURL!).origin, testInfo.title.includes('two additions'));
    try { await use(proxy.options); } finally { await proxy.close(); }
  },
  serviceWorkers: 'block',
});

test('review: active option stays valid after a quick-preset selection', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/compare?series=');
  const input = page.getByRole('combobox', {name: 'Lägg till gata eller stadsdel'});
  await input.focus();
  const count = await page.getByRole('option').count();
  for (let i=0; i<count; i++) await input.press('ArrowDown');
  await input.press('Tab');
  await page.getByRole('region', {name: 'Snabbval'}).getByRole('link', {name: 'Östermalm', exact:true}).click();
  await expect(page.getByRole('group', {name:'Valda serier'}).getByRole('link')).toHaveCount(1);
  await input.focus();
  await input.press('Enter');
  await expect.poll(() => errors).toEqual([]);
  await expect(page.getByRole('group', {name:'Valda serier'}).getByRole('link')).toHaveCount(2);
});

test('review: initial ArrowUp highlights the final option', async ({page}) => {
  await page.goto('/compare?series=');
  const input = page.getByRole('combobox', {name:'Lägg till gata eller stadsdel'});
  await input.focus();
  await input.press('ArrowUp');
  await expect(page.getByRole('option').last()).toHaveAttribute('aria-selected','true');
});

test('review: composing Enter does not select a comparison series', async ({page}) => {
  await page.goto('/compare?series=&g=year');
  const input = page.getByRole('combobox', {name:'Lägg till gata eller stadsdel'});
  await input.fill('Vasastan');
  await input.dispatchEvent('keydown', {key:'Enter', code:'Enter', isComposing:true, bubbles:true});
  await expect(page).toHaveURL(/series=&g=year$/);
  await expect(page.getByRole('option', {name:'Vasastan', exact:true})).toBeVisible();
});

test('review: annual street comparison link preserves granularity', async ({page}) => {
  await page.goto('/street/sodermalm/gotgatan?g=year');
  await page.getByRole('link', {name:'Jämför →', exact:true}).click();
  await expect(page).toHaveURL(/\/compare\?/);
  await expect(page).toHaveURL(/g=year/);
  await expect(page.getByRole('group', {name:'Tidsupplösning'}).getByRole('link', {name:'År', exact:true})).toHaveAttribute('aria-current', 'true');
});

test('review: two additions during a slow navigation both survive', async ({page}) => {
  await page.goto('/compare?series=');
  const input = page.getByRole('combobox', {name:'Lägg till gata eller stadsdel'});
  const waiting = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.searchParams.get('series') === 'district:vasastan' && url.searchParams.has('_rsc');
  });
  await input.fill('Vasastan');
  await page.keyboard.press('Enter');
  await waiting;
  await expect(page.getByRole('group', {name:'Valda serier'}).getByRole('link')).toHaveCount(0);
  await expect(input).toHaveValue('');
  await page.keyboard.insertText('Götgatan');
  await expect(page.getByRole('option', {name:'Götgatan (Södermalm)', exact:true})).toBeVisible();
  await page.keyboard.press('Enter');
  const selected = page.getByRole('group', {name:'Valda serier'});
  await expect(selected.getByRole('link', {name:'Ta bort Götgatan (Södermalm)', exact:true})).toBeVisible();
  await expect(selected.getByRole('link', {name:'Ta bort Vasastan', exact:true})).toBeVisible();
});

for (const [name,path,heading] of [
  ['insights','/insights','Mönster i Stockholms innerstad'],
  ['compare','/compare?series=street:sodermalm/gotgatan&g=year','Götgatan (Södermalm)'],
  ['district','/district/ostermalm?rooms=1&g=year','Östermalm'],
  ['street','/street/ostermalm/karlavagen?rooms=1&g=year','Karlavägen'],
  ['house','/street/ostermalm/karlavagen/2?g=year','Karlavägen 2'],
] as const) {
  test(`review: ${name} recovers from a real query failure without losing URL`, async ({page,baseURL}) => {
    const prisma = new PrismaClient({datasourceUrl:testDatabaseUrl()});
    const db = await prisma.$queryRawUnsafe<Array<{name:string}>>('SELECT current_database() AS name');
    expect(db[0].name).toBe('bostadspriser_test_r_e_f9');
    let renamed = false;
    try {
      await prisma.$executeRawUnsafe('ALTER MATERIALIZED VIEW "DedupedListingMat" RENAME TO "ReviewTemporarilyUnavailable"');
      renamed = true;
      await page.goto(path);
      await expect(page.getByRole('heading',{name:/Kunde inte ladda/})).toBeVisible();
      await expect(page.locator('body')).not.toContainText('DedupedListingMat');
      await expect(page.locator('body')).not.toContainText('PrismaClientKnownRequestError');
      await prisma.$executeRawUnsafe('ALTER MATERIALIZED VIEW "ReviewTemporarilyUnavailable" RENAME TO "DedupedListingMat"');
      renamed = false;
      const retryResponse = page.waitForResponse(response => new URL(response.url()).searchParams.has('_rsc'));
      await page.getByRole('button',{name:'Försök igen',exact:true}).click();
      const refreshed = await retryResponse;
      const payload = await refreshed.text();
      writeFileSync(`/tmp/review-f19-${name}-rsc.txt`, payload);
      console.log('RETRY', name, refreshed.status(), 'has error record:', /\n[\da-f]+:E\{/.test(payload), 'healthy data:', /points|StatCard|medianPricePerSqm/.test(payload));
      await expect.soft(page.getByRole('heading',{level:1,name:heading,exact:true})).toBeVisible({timeout:2000});
      await expect(page).toHaveURL(baseURL + path);
      await page.reload();
      await expect(page.getByRole('heading',{level:1,name:heading,exact:true})).toBeVisible();
      console.log('RELOAD RECOVERS',name);
    } finally {
      if (renamed) await prisma.$executeRawUnsafe('ALTER MATERIALIZED VIEW "ReviewTemporarilyUnavailable" RENAME TO "DedupedListingMat"');
      await prisma.$disconnect();
    }
  });
}
```

reviewer-originProxy.ts

```ts
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
    if (delayComparison && destination.searchParams.get('series') === 'district:vasastan' && destination.searchParams.has('_rsc')) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    const upstream = request(destination, {
      method: incoming.method,
      headers: { ...incoming.headers, host: destination.host },
    }, (response) => {
      response.once("error", () => outgoing.destroy());
      response.once("close", () => {
        if (!response.complete) outgoing.destroy();
      });
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    pending.add(upstream);
    upstream.once("close", () => pending.delete(upstream));
    upstream.once("error", () => outgoing.destroy());
    incoming.once("aborted", () => upstream.destroy());
    outgoing.once("close", () => upstream.destroy());
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
