# F44 adversarial review

Commit: `482598528af99b9a4d5fe68f9f967422ad494af9` (parent `e43485c4bca6cc37996ceee0c2e18616ed48f67b`).
Verdict: **APPROVE**. No blocker, major, minor, or nit in this patch requires a change.

Read the current main HANDOFF, AGENTS, CLAUDE, reviewer brief, agent brief, and authoritative F44/F39 backlog entries. Reviewed the immutable source commit in detached `/tmp/review-f44`; source `/tmp/bostadspriser-hardening-e-audit` and main were not edited. The production diff is only two CSS-class lines. Optional F39's desktop empty cell is preserved and is not a defect against F44.

## Independent evidence

- Production build, including lint/types, passed independently. Source full-gate log `/tmp/e-audit-f44-gate.log` separately records 543 Vitest, 372 Playwright, 764 pytest and a green gate; it was not substituted for the review probes.
- The initial browser run passed all 20 committed F44 cases, all 10 existing stats cases, and all 10 independent hydrated geometry/stress cases (desktop Chromium and Pixel 7): **40 passed**. The 10 other exploratory cases exposed pre-existing no-JavaScript/large-root-font behavior described below; they are not hidden or characterized as green.
- Per-character text rectangles and card bounds, full DOM/accessible text, console errors, unchanged text after resizing, responsive column counts, and document overflow were checked on district, street, address, and insights pages at 320, 375, 639, 640, 768, 1023, 1024 and 1280px. Annual navigation completed before measurements on chart pages, exercising hydration and real client navigation.
- Stress values include a 30-digit unbroken number, repeated NBSP numeric groups, an em dash, full dates, an unbroken Swedish/diacritic street name, a long uppercase label and a long hint. Actual card contents remain complete and fit; no ellipsis, hidden text or page overflow at normal font size. `/insights` still uses two narrow columns and consequently breaks some numeric groups over lines, but retains all digits and no longer clips them.
- With external JavaScript bundles aborted, the server-streamed content still appears through its inline reveal scripts and the four routes pass content-fit checks at 320, 640 and 1280px. This is pre-hydration evidence, distinct from disabling JavaScript entirely.
- Independently inspected the committed nine screenshots (contact sheet and full 320px address image), the reviewer card screenshots/contact sheet, and long-value images. `cards-2-320-jstrue-desktop.png` shows the full Karlavägen and Försäljningar. `ssr-parent-2-desktop.png` visibly reproduces the cut-off originals. Screen-reader snapshots retain the full text; the diff does not alter roles, reading order, interactive elements, colors or focus handling.

## Mandatory production-only reversion

Restored **only** `StatCard.tsx` and `SummaryCards.tsx` to `4825985^`, retained all tests, rebuilt production, then ran the committed proving tests and independent SSR probes. The exact reverse patch is `production-reversion.patch`.

- Committed F44 tests: **8 failed / 12 controls passed**. Both projects fail all three 320px pages plus the unbroken-name case for measured content outside its paragraph/card. 640px and 1280px controls pass.
- Independent no-hydration geometry: **8 failed / 8** (all four routes on both projects), for the same actual text-fit problem.
- The overall reversion log is 19 failed / 13 passed because it also includes four exploratory baseline diagnostics: two no-JavaScript failures, one desktop root-font overflow failure, and one mobile root-font diagnostic which measures expanded `innerWidth` and therefore passes. That mobile diagnostic is not evidence of absence of overflow; the initial probe uses document client width and catches it on both projects.
- Restored both production files to `4825985` and rebuilt. Final focused restoration: **28 passed** (20 committed F44 cases plus 8 SSR geometry cases), recorded in `restored.log`. Across the initial and restored runs, **48 distinct F44-relevant/stats browser cases passed**. The separately investigated baseline diagnostics are explicitly excluded from this confirmation command, not skipped in committed code.

## Separate, pre-existing follow-up candidates

These are outside F44's narrow content-clipping acceptance. No added mandatory item is needed to approve this commit; triage these separately if no-JavaScript support and enlarged default text are desired.

1. **Minor, no-JavaScript analytics rendering.** `web/src/app/street/[district]/[street]/[house]/loading.tsx:3` (same pattern on district, street, insights), `web/src/components/AnalyticsLoading.tsx:7`. With JavaScript disabled, completed content stays under React's hidden `div#S:1` and users see only “Laddar adressens priser…” and skeletons. Fixed and parent address ancestor/ARIA JSON files are byte-identical, and both screenshots show the same shell. Consider a readable non-streaming server/noscript fallback if this mode is supported. All four routes fail the initial no-JavaScript visibility probe in both browser projects. This does not implicate CSS wrapping or hydration.
2. **Minor, large-root-font reflow.** `web/src/components/SiteHeader.tsx:18`, `web/src/app/district/[slug]/page.tsx:110`. At 320px after setting root font to 32px, header menu and chart controls extend beyond the viewport. Desktop document width is **541px on both revisions**; the first nine overflowing element measurements are identical. Fixed summary-card glyphs themselves remain within their cards. Consider wrapping these separate flex layouts. This is an exploratory 200%-root-font stress case, not a failure of the normal 320px F44 layout.

## Commands and artifacts

All builds/tests ran with `TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115`, empty compiled Mapbox token and the repository's exact-origin browser proxy. No live providers, protected `.env`/scraper state/cache, dev DB, foreign processes, remote writes or commits were touched. No full unrelated gate was run.

```sh
git -C '/Users/carlwelen/Documents/ChatGPT/Booli scraper/temp' worktree add --detach /tmp/review-f44 482598528af99b9a4d5fe68f9f967422ad494af9
cd /tmp/review-f44/web
pnpm install --frozen-lockfile
TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115 pnpm exec prisma generate
TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115 pnpm e2e:build
TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115 pnpm test:e2e e2e/summary-cards.spec.ts e2e/stats.spec.ts e2e/review-f44.spec.ts
TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115 pnpm test:e2e e2e/review-f44-ssr.spec.ts --project desktop
cd /tmp/review-f44
git checkout 4825985^ -- web/src/components/StatCard.tsx web/src/components/SummaryCards.tsx
TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115 pnpm --dir web e2e:build
cd web
REVIEW_VARIANT=parent TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115 pnpm test:e2e e2e/summary-cards.spec.ts e2e/review-f44-ssr.spec.ts
cd ..
git checkout 4825985 -- web/src/components/StatCard.tsx web/src/components/SummaryCards.tsx
TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115 pnpm --dir web e2e:build
cd web
TEST_DB_NAME=bostadspriser_test_r_f44 E2E_PORT=3115 pnpm test:e2e e2e/summary-cards.spec.ts e2e/review-f44-ssr.spec.ts --grep-invert 'diagnostic|root text'
```

An initial test-server start was launched before the first build finished and failed for absent `prerender-manifest.json`; it ran zero tests. It is retained as `premature-start.log`. The completed build and subsequent runs are authoritative. Failed-test traces/context are preserved in `initial-results/`, `ssr-fixed-results/` and `reversion-results/`. Other logs are `build.log`, `green.log`, `ssr-fixed.log`, `reversion-build.log`, `reversion.log`, `restored-build.log` and `restored.log`. Geometry JSON, screenshots, exact added probes and the committed proving test are adjacent to this report.

## Exact independent probes

### review-f44.spec.ts

```ts
import { writeFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const routes = ["/district/ostermalm", "/street/ostermalm/karlavagen", "/street/ostermalm/karlavagen/2", "/insights"];
const summary = (page: Page) => page.locator("main > section").first();

async function geometry(section: Locator) {
  return section.evaluate((root) => {
    const problems: string[] = [];
    const cards = Array.from(root.children) as HTMLElement[];
    for (const card of cards) {
      const bounds = card.getBoundingClientRect();
      if (bounds.left < -1 || bounds.right > innerWidth + 1) problems.push(`card outside viewport: ${card.textContent}`);
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      let text: Node | null;
      while ((text = walker.nextNode())) {
        if (!text.textContent?.trim()) continue;
        const paragraph = text.parentElement!.closest("p")!;
        const pb = paragraph.getBoundingClientRect();
        if (getComputedStyle(paragraph).textOverflow === "ellipsis" || paragraph.closest('[aria-hidden="true"], [hidden], [inert]')) {
          problems.push(`hidden/ellipsized text: ${text.textContent}`);
        }
        for (let i = 0; i < text.textContent.length; i++) {
          if (/\s/.test(text.textContent[i])) continue;
          const range = document.createRange();
          range.setStart(text, i); range.setEnd(text, i + 1);
          for (const r of range.getClientRects()) {
            if (r.left < pb.left - 1 || r.right > pb.right + 1 || r.top < bounds.top || r.bottom > bounds.bottom) {
              problems.push(`glyph outside paragraph/card: ${text.textContent} [${i}]`);
              break;
            }
          }
        }
      }
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) problems.push("horizontal page overflow");
    return { problems, texts: cards.map(c => c.textContent), columns: getComputedStyle(root).gridTemplateColumns.split(" ").length };
  });
}

for (const js of [false, true]) {
  test.describe(`JavaScript ${js ? "enabled" : "disabled"}`, () => {
    test.use({ javaScriptEnabled: js });
    for (const [index, route] of routes.entries()) {
      test(`complete production card geometry ${route}`, async ({ page, consoleErrors }, info) => {
        await page.setViewportSize({ width: 320, height: 900 });
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const section = summary(page);
        await expect(section.getByText("Försäljningar", { exact: true })).toBeVisible();
        if (js && route !== "/insights") {
          await page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "År", exact: true }).click();
          await expect(page).toHaveURL(/g=year/);
          await expect(page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "År", exact: true })).toHaveAttribute("aria-current", "true");
          await page.waitForLoadState("networkidle");
        }
        const baselineText = await section.textContent();
        const measurements = [];
        for (const width of [320, 375, 639, 640, 768, 1023, 1024, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          const result = await geometry(section);
          expect(result.problems, `${route} ${width}px JS=${js}`).toEqual([]);
          if (route !== "/insights") expect(result.columns).toBe(width < 640 ? 1 : width < 1024 ? 2 : 3);
          expect(await section.textContent()).toBe(baselineText);
          measurements.push({ width, ...result });
          if ([320, 640, 1280].includes(width)) {
            await section.screenshot({ path: `/tmp/r-f44/cards-${index}-${width}-js${js}-${info.project.name}.png` });
          }
        }
        const accessible = await section.ariaSnapshot();
        expect(accessible).toContain("Försäljningar");
        expect(accessible).toContain("Median pris/m²");
        if (index === 2) expect(accessible).toContain("Karlavägen");
        writeFileSync(`/tmp/r-f44/geometry-${index}-js${js}-${info.project.name}.json`, JSON.stringify({ measurements, accessible }, null, 2));
        expect(consoleErrors).toEqual([]);
      });
    }
  });
}

test("long labels, hints, NBSP numeric values and street names remain complete", async ({ page, consoleErrors }, info) => {
  await page.goto(routes[2]);
  await page.waitForLoadState("networkidle");
  const section = summary(page);
  const values = ["999999999999999999999999999999", "999\u00a0999\u00a0999\u00a0999\u00a0999\u00a0999 kr", "—", "2025-01-10 → 2026-10-25", "LiljeholmsstrandspromenadenÖÄÅéSanktEriksgatan"];
  await section.evaluate((root, values) => {
    Array.from(root.children).forEach((card, i) => {
      card.children[1].textContent = values[i];
      if (i === 0) card.children[0].textContent = "FörsäljningsstatistikÖstermalmslägenheter";
      if (i === 1) card.children[2].textContent = "Långtsammanhängandeförklaringsordmedåäöéochslutpunkt.";
    });
  }, values);
  for (const width of [320, 640, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await geometry(section)).problems).toEqual([]);
    for (const [i, value] of values.entries()) await expect(section.locator(":scope > div").nth(i).locator("p").nth(1)).toHaveText(value);
    await section.screenshot({ path: `/tmp/r-f44/long-values-${width}-${info.project.name}.png` });
  }
  expect(consoleErrors).toEqual([]);
});

test("larger default text retains complete cards at 320px", async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(routes[0]);
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "html { font-size: 32px; }" });
  expect((await geometry(summary(page))).problems).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

```

### review-f44-ssr.spec.ts

```ts
import { writeFileSync } from "node:fs";
import { test, expect } from "./fixtures";

for (const [index, route] of ["/district/ostermalm", "/street/ostermalm/karlavagen", "/street/ostermalm/karlavagen/2", "/insights"].entries()) {
  test(`SSR text fits without hydration ${route}`, async ({ page }, info) => {
    let blocked = 0;
    await page.route("**/*.js", route => { blocked++; return route.abort(); });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    expect(blocked).toBeGreaterThan(0);
    const section = page.locator("main > section").first();
    await expect(section.getByText("Försäljningar", { exact: true })).toBeVisible();
    await section.screenshot({ path: `/tmp/r-f44/ssr-${process.env.REVIEW_VARIANT ?? "fixed"}-${index}-${info.project.name}.png` });
    const before = await section.textContent();
    for (const width of [320, 640, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const problems = await section.locator("p").evaluateAll(ps => ps.flatMap(p => {
        const card = p.parentElement!.getBoundingClientRect();
        const box = p.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(p);
        return [...range.getClientRects()].some(r => r.left < box.left-1 || r.right > box.right+1 || r.top < card.top || r.bottom > card.bottom) ? [p.textContent] : [];
      }));
      expect(problems).toEqual([]);
      expect(await section.textContent()).toBe(before);
    }
    writeFileSync(`/tmp/r-f44/ssr-${index}-${info.project.name}.json`, JSON.stringify({ blocked, text: before, accessible: await section.ariaSnapshot() }, null, 2));
  });
}

test.describe("no-JavaScript diagnostic", () => {
  test.use({ javaScriptEnabled: false });
  test("record streamed shell and hidden ancestors", async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/street/ostermalm/karlavagen/2");
    await page.waitForLoadState("networkidle");
    const text = page.getByText("Gata", { exact: true });
    const ancestors = await text.evaluate(node => {
      const out = [];
      for(let n: Element | null = node; n; n = n.parentElement) out.push({ tag: n.tagName, id: n.id, hidden: n.hasAttribute("hidden"), display: getComputedStyle(n).display });
      return out;
    });
    const suffix = process.env.REVIEW_VARIANT ?? "fixed";
    writeFileSync(`/tmp/r-f44/nojs-${suffix}-${info.project.name}.json`, JSON.stringify({ ancestors, accessible: await page.locator("body").ariaSnapshot() }, null, 2));
    await page.screenshot({ path: `/tmp/r-f44/nojs-${suffix}-${info.project.name}.png` });
    await expect(text).toBeVisible();
  });
});

test("record 200 percent root text overflow", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/district/ostermalm");
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "html { font-size: 32px; }" });
  const result = await page.evaluate(() => ({
    viewport: innerWidth, scroll: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll("body *")].flatMap(n => {
      const r = n.getBoundingClientRect();
      return r.right > innerWidth + 1 || r.left < -1 ? [{tag: n.tagName, cls: n.className.toString(), text: n.textContent?.slice(0, 150), left: r.left, right: r.right}] : [];
    }),
  }));
  const suffix = process.env.REVIEW_VARIANT ?? "fixed";
  writeFileSync(`/tmp/r-f44/root32-${suffix}-${info.project.name}.json`, JSON.stringify(result, null, 2));
  await page.screenshot({ path: `/tmp/r-f44/root32-${suffix}-${info.project.name}.png` });
  expect(result.scroll).toBeLessThanOrEqual(result.viewport);
});

```

## Cleanup

Source was rechecked clean at the reviewed immutable SHA; the two scratch production files matched that SHA exactly after restoration. All browser/server runs exited. The detached reviewer worktree was removed after preserving the report, probes, logs, geometry and screenshots under `/tmp/r-f44/`.
