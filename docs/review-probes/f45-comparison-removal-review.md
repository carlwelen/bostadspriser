# F45 adversarial review

Verdict: APPROVE

Commit: `e43485c4bca6cc37996ceee0c2e18616ed48f67b`.
Parent: `582efba8d1db9745434bb58806e3d8e0db0520d4`.
Scope: pending removal affordance in `CompareBuilder`, added browser regression tests, screenshots.

Concrete findings: none. New backlog items: none.

## Evidence

- Independent production build, focused browser suite: **28/28 passed** across desktop Chrome and Pixel 7. This includes all original builder/navigation tests, the two committed F45 tests, and three independent probes per device. Log: `fixed-focused.log`.
- The original `compare-builder.spec.ts` is unchanged: parent and reviewed commit both have blob `14fa0be78d3f3a3e8f275a37b6c533d6fdcbddaa`. No new skips, weakened assertions, or expected failures.
- Production-only parent reversion: restored **only** `web/src/components/CompareBuilder.tsx` from the parent and rebuilt. All committed tests remained unchanged. **4 expected failures, 8 passes**: the committed pending test fails on enabled removal links, and the independent actionable-click probe proves a locator click completes while its mutation is silently ignored. Both failures reproduce on both devices. Log: `parent-red-and-observation.log`.
- Direct parent observation independently reproduces the original defect: while the first RSC transition is held, the second removal is enabled, retains its old href, and **five real pointer clicks plus three Enter presses** do nothing. Exactly one mutation remains outstanding and all three old chips remain visible. The request is released in `finally`, after which current-state keyboard and pointer removals work.
- Fixed pending behavior: links expose `aria-disabled=true`, wait cursor and 0.5 opacity, the input is disabled, and Swedish updating status is visible. Pointer and Enter attempts during the held transition cannot issue a stale request. Once complete, the street removal href contains only Vasastan and preserves `g=year`; keyboard removal followed by pointer removal reaches the empty-selection state.
- The independent actionable-click probe starts the same next removal while the previous transition is held. On fixed code it remains waiting, then navigates using the newly committed selection. Observed requests are exactly `street:sodermalm/gotgatan,district:vasastan`, followed by `district:vasastan`. On parent it instead completes early with no second request.
- Hydrated **genuine native middle-click and ControlOrMeta-click** open new tabs with the expected current href and page title, leaving the original selection intact, on both devices. Existing links and the capture guard remain unchanged.
- Restored exact reviewed production code, rebuilt, and ran the independent actionable-click/native-link probes plus an expanded rapid-input probe: **8/8 passed**. Log: `restored-focused.log`.
- Reviewed committed desktop/mobile pending screenshots visually; disabled chips and updating status are visible. Own fixed/parent browser artifacts are saved in `fixed-test-results/`, `parent-test-results/`, and `restored-test-results/`.

Only the scratch worktree was mutated. Test DB `bostadspriser_test_r_f45`, port `3115`; production builds had empty Mapbox token and browser tests used the hermetic origin proxy. No live providers, protected files, dev DB, source/main edits, commits, pushes or foreign-process kills. Full unrelated suites were not repeated. The source full-gate log `/tmp/e-audit-f45-gate.log` reports 543 Vitest, 352 browser and 764 pytest passes; independent review evidence is the focused work above.

## Exact commands

```sh
git -C '/Users/carlwelen/Documents/ChatGPT/Booli scraper/temp' worktree add --detach /tmp/review-f45 e43485c
mkdir -p /tmp/r-f45
cd /tmp/review-f45/web
pnpm install --frozen-lockfile
TEST_DB_NAME=bostadspriser_test_r_f45 E2E_PORT=3115 pnpm e2e:build > /tmp/r-f45/build-fixed.log 2>&1
# Write r-f45-probe.spec.ts below into web/e2e/.
cd /tmp/review-f45
TEST_DB_NAME=bostadspriser_test_r_f45 E2E_PORT=3115 pnpm --dir web exec playwright test e2e/compare-builder.spec.ts e2e/compare-navigation.spec.ts e2e/compare-removal-pending.spec.ts e2e/r-f45-probe.spec.ts > /tmp/r-f45/fixed-focused.log 2>&1
cp -R web/test-results /tmp/r-f45/fixed-test-results
# Write r-f45-parent-observation.spec.ts below into web/e2e/.
git checkout e43485c^ -- web/src/components/CompareBuilder.tsx
TEST_DB_NAME=bostadspriser_test_r_f45 E2E_PORT=3115 pnpm --dir web e2e:build > /tmp/r-f45/build-parent.log 2>&1
cd web
TEST_DB_NAME=bostadspriser_test_r_f45 E2E_PORT=3115 pnpm exec playwright test e2e/compare-removal-pending.spec.ts e2e/r-f45-probe.spec.ts e2e/r-f45-parent-observation.spec.ts > /tmp/r-f45/parent-red-and-observation.log 2>&1
# Exit 1 expected: 4 semantic/behavioral failures, 8 passes.
cd ..
cp -R web/test-results /tmp/r-f45/parent-test-results
git checkout e43485c -- web/src/components/CompareBuilder.tsx
# Write r-f45-rapid-probe.spec.ts below into web/e2e/.
TEST_DB_NAME=bostadspriser_test_r_f45 E2E_PORT=3115 pnpm --dir web e2e:build > /tmp/r-f45/build-restored.log 2>&1
cd web
TEST_DB_NAME=bostadspriser_test_r_f45 E2E_PORT=3115 pnpm exec playwright test e2e/r-f45-probe.spec.ts e2e/r-f45-rapid-probe.spec.ts > /tmp/r-f45/restored-focused.log 2>&1
cd ..
cp -R web/test-results /tmp/r-f45/restored-test-results
git -C '/Users/carlwelen/Documents/ChatGPT/Booli scraper/temp' worktree remove --force /tmp/review-f45
```

## Independent probe source

### r-f45-probe.spec.ts

```ts
import { expect, test } from './fixtures';

test('review: actionable click waits through pending and uses committed href', async ({ page, consoleErrors }) => {
  const selected = page.getByRole('group', { name: 'Valda serier' });
  const input = page.getByRole('combobox', { name: 'Lägg till gata eller stadsdel' });
  const street = selected.getByRole('link', { name: 'Ta bort Götgatan (Södermalm)', exact: true });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let intercepted!: () => void;
  const requested = new Promise<void>(resolve => { intercepted = resolve; });
  const mutations: string[] = [];
  await page.route('**/compare?**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.searchParams.has('_rsc') || request.headers()['next-router-prefetch']) return route.fallback();
    const ids = url.searchParams.get('series') ?? '';
    mutations.push(ids);
    if (ids === 'street:sodermalm/gotgatan,district:vasastan') {
      intercepted();
      await held;
    }
    await route.continue();
  });
  await page.goto('/compare?series=district:ostermalm,street:sodermalm/gotgatan,district:vasastan&g=year');
  await input.fill('ready');
  await input.clear();
  await input.press('Escape');
  await selected.getByRole('link', { name: 'Ta bort Östermalm', exact: true }).click();
  await requested;
  let completed = false;
  const click = street.click().then(() => { completed = true; });
  try {
    await page.waitForTimeout(200);
    console.log(JSON.stringify({phase:'held', completed, mutations, disabled: await street.getAttribute('aria-disabled'), href: await street.getAttribute('href')}));
    expect(completed, 'an actionable removal must wait for the pending transition').toBe(false);
    expect(mutations).toEqual(['street:sodermalm/gotgatan,district:vasastan']);
  } finally {
    release();
    await click;
  }
  await expect(selected.getByRole('link')).toHaveCount(1);
  await expect(selected.getByRole('link').first()).toHaveAccessibleName('Ta bort Vasastan');
  expect(mutations).toEqual(['street:sodermalm/gotgatan,district:vasastan', 'district:vasastan']);
  await expect(page).toHaveURL(/series=district%3Avasastan&g=year$/);
  expect(consoleErrors).toEqual([]);
});

for (const gesture of ['middle', 'modifier'] as const) {
  test(`review: hydrated removal preserves genuine ${gesture} new-tab navigation`, async ({ page, context, consoleErrors }) => {
    await page.goto('/compare?series=district:ostermalm,district:vasastan&g=year');
    const input = page.getByRole('combobox', { name: 'Lägg till gata eller stadsdel' });
    await input.fill('ready');
    await input.clear();
    await input.press('Escape');
    const remove = page.getByRole('link', { name: 'Ta bort Östermalm', exact: true });
    await expect(remove).toBeEnabled();
    await expect(remove).toHaveAttribute('href', '/compare?series=district%3Avasastan&g=year');
    const opened = context.waitForEvent('page');
    await remove.click(gesture === 'middle' ? { button: 'middle' } : { modifiers: ['ControlOrMeta'] });
    const tab = await opened;
    await expect(tab).toHaveURL(/series=district%3Avasastan&g=year$/);
    await expect(tab.getByRole('heading', { level: 1 })).toHaveText('Vasastan');
    await expect(page.getByRole('group', { name: 'Valda serier' }).getByRole('link')).toHaveCount(2);
    await tab.close();
    expect(consoleErrors).toEqual([]);
  });
}
```

### r-f45-parent-observation.spec.ts

```ts
import { expect, test } from "./fixtures";

test("review: parent still appears actionable while real pointer and keyboard removals are ignored", async ({ page, consoleErrors }, info) => {
  const selected = page.getByRole("group", { name: "Valda serier" });
  const removeStreet = selected.getByRole("link", { name: "Ta bort Götgatan (Södermalm)", exact: true });
  const input = page.getByRole("combobox", { name: "Lägg till gata eller stadsdel" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted!: () => void;
  const requested = new Promise<void>((resolve) => { intercepted = resolve; });
  const mutations: string[] = [];
  await page.route("**/compare?**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.searchParams.has("_rsc")) return route.fallback();
    if (!request.headers()["next-router-prefetch"]) mutations.push(url.searchParams.get("series") ?? "");
    if (url.searchParams.get("series") === "street:sodermalm/gotgatan,district:vasastan") {
      intercepted();
      await held;
    }
    await route.continue();
  });

  await page.goto("/compare?series=district:ostermalm,street:sodermalm/gotgatan,district:vasastan&g=year");
  await input.fill("ready");
  await input.clear();
  await input.press("Escape");
  await selected.getByRole("link", { name: "Ta bort Östermalm", exact: true }).click();
  await requested;
  try {
    await expect(page.getByRole("status")).toHaveText("Uppdaterar jämförelsen…");
    await expect(input).toBeDisabled();
    await expect(removeStreet).toBeEnabled();
    await expect(removeStreet).not.toHaveCSS("cursor", "wait");
    await expect(removeStreet).toHaveAttribute("href", /district%3Aostermalm.*district%3Avasastan.*g=year/);
    // Real pointer and keyboard activation must not start a stale mutation.
    await removeStreet.scrollIntoViewIfNeeded();
    const box = (await removeStreet.boundingBox())!;
    for (let i = 0; i < 5; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await removeStreet.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
    await expect(selected.getByRole("link")).toHaveCount(3);
    expect(mutations).toHaveLength(1);
    console.log(JSON.stringify({ phase: "parent held", mutations, disabled: await removeStreet.getAttribute("aria-disabled"), pointerAttempts: 5, enterAttempts: 3, selectionCount: await selected.getByRole("link").count() }));
    await page.screenshot({ path: info.outputPath("pending.png"), fullPage: true });
  } finally {
    release();
  }

  await expect(selected.getByRole("link")).toHaveCount(2);
  await expect(removeStreet).toBeEnabled();
  await expect(removeStreet).toHaveAttribute("href", "/compare?series=district%3Avasastan&g=year");
  await removeStreet.focus();
  await page.keyboard.press("Enter");
  await expect(selected.getByRole("link")).toHaveCount(1);
  await selected.getByRole("link", { name: "Ta bort Vasastan", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inga serier valda");
  await expect(page).toHaveURL(/series=&g=year$/);
  expect(consoleErrors).toEqual([]);
});
```

### r-f45-rapid-probe.spec.ts

```ts
import { expect, test } from "./fixtures";

test("review: rapid pointer and keyboard remain locked with visible pending affordance", async ({ page, consoleErrors }, info) => {
  const selected = page.getByRole("group", { name: "Valda serier" });
  const removeStreet = selected.getByRole("link", { name: "Ta bort Götgatan (Södermalm)", exact: true });
  const input = page.getByRole("combobox", { name: "Lägg till gata eller stadsdel" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted!: () => void;
  const requested = new Promise<void>((resolve) => { intercepted = resolve; });
  const mutations: string[] = [];
  await page.route("**/compare?**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.searchParams.has("_rsc")) return route.fallback();
    if (!request.headers()["next-router-prefetch"]) mutations.push(url.searchParams.get("series") ?? "");
    if (url.searchParams.get("series") === "street:sodermalm/gotgatan,district:vasastan") {
      intercepted();
      await held;
    }
    await route.continue();
  });

  await page.goto("/compare?series=district:ostermalm,street:sodermalm/gotgatan,district:vasastan&g=year");
  await input.fill("ready");
  await input.clear();
  await input.press("Escape");
  await selected.getByRole("link", { name: "Ta bort Östermalm", exact: true }).click();
  await requested;
  try {
    await expect(page.getByRole("status")).toHaveText("Uppdaterar jämförelsen…");
    await expect(input).toBeDisabled();
    await expect(removeStreet).toBeDisabled();
    await expect(removeStreet).toHaveCSS("cursor", "wait");
    await expect(removeStreet).toHaveCSS("opacity", "0.5");
    await expect(removeStreet).toHaveAttribute("href", /district%3Aostermalm.*district%3Avasastan.*g=year/);
    // Real pointer and keyboard activation must not start a stale mutation.
    await removeStreet.scrollIntoViewIfNeeded();
    const box = (await removeStreet.boundingBox())!;
    for (let i = 0; i < 5; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await removeStreet.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
    await expect(selected.getByRole("link")).toHaveCount(3);
    expect(mutations).toHaveLength(1);
    console.log(JSON.stringify({ phase: "fixed held", mutations, disabled: await removeStreet.getAttribute("aria-disabled"), pointerAttempts: 5, enterAttempts: 3, selectionCount: await selected.getByRole("link").count() }));
    await page.screenshot({ path: info.outputPath("pending.png"), fullPage: true });
  } finally {
    release();
  }

  await expect(selected.getByRole("link")).toHaveCount(2);
  await expect(removeStreet).toBeEnabled();
  await expect(removeStreet).toHaveAttribute("href", "/compare?series=district%3Avasastan&g=year");
  await removeStreet.focus();
  await page.keyboard.press("Enter");
  await expect(selected.getByRole("link")).toHaveCount(1);
  await selected.getByRole("link", { name: "Ta bort Vasastan", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inga serier valda");
  await expect(page).toHaveURL(/series=&g=year$/);
  expect(consoleErrors).toEqual([]);
});
```
