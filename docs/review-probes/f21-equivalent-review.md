# F21 equivalent review

**APPROVE** — `681cb6b335f8e839882853a248cd7a675e9adce9`.

No concrete blocker, major, minor, or new backlog finding. Reviewed the actual implementation and tests on detached scratch `/tmp/review-f21-equivalent`; main and the implementer worktree remained read-only. Preparation parent `f8c63d8` is not approved for merging as a task. Integrate only this equivalent task commit, replacing original `7b5e461`.

## Equivalence and conflict resolution

Independent Git-object comparison confirms the same 24 changed paths as `7b5e461`; all 23 nonconflicting paths have exactly the original additions/deletions, including byte-identical screenshot blobs. The complete resolved `AddressDrawer.chart.test.ts` equals its preparation-parent version with only the original F21 named-chart test inserted immediately before the intact F12 keyboard regression. The F12 ResizeObserver stub, original `white` / `#1d4ed8` expectations, and keyboard test remain unchanged. No F22 token changes were introduced. The checker and full results are saved in `check-equivalence.py` and `equivalence.txt`.

## Validation

- Production build passed, including Next lint/type validation.
- **60/60 focused unit tests passed** after restoration: 57 existing affected tests plus 3 reviewer probes.
- **34/34 production-browser tests passed**, desktop and Pixel 7: 26 analytics/accessibility/granularity/house/reviewer tests plus 8 native-search/IME tests. Tests use the exact-origin hermetic fixture, empty Mapbox build token, `bostadspriser_test_r_f21eq`, and port 3114.
- Reviewer probes cover empty datasets; Swedish accented and markup-like names; month/year and DST-adjacent display; all-series table rows; low-count boundary 2/3; null rooms and repeated scatter observations; keyboard disclosure opening/closing; actual horizontal keyboard scrolling at 320px without page overflow; chart names; table captions/scopes; and named footer navigation.
- Existing real-Recharts drawer tests cover focused chart naming alongside keyboard tooltip entry, retention and dismissal. Modified-click/IME browser tests remain green with the new selection callback.
- Full gate was not repeated; these are independent focused checks, not a claim to have rerun the implementer's 535/322/764 gate.

## Meaningful reversions

**Yes, the proving tests fail without the fix.** Restored all 11 changed production paths to `681cb6b^`, retaining the new tests. The same 57-test focused unit command produced **8 failures / 49 passes**. Six failures directly prove missing chart/table semantics, missing drawer group/pressed state, missing drawer chart name, and the menu remaining expanded after selection. Two additional failures are the existing modal-stack tests whose updated group-button selectors correctly no longer find the parent tab widgets. This was a real production reversion, not a test assertion mutation. See `reversion.log` and `reverted-paths.txt`.

Separately restored F21 and removed only the inherited drawer `onBlurCapture` guard. The unchanged F12 keyboard regression failed at line 182 because the tooltip becomes null when focus enters its content; the F21 named-chart test still passed (**1 fail / 1 pass**, 10 tests excluded by the explicit name filter). This confirms the additive resolution retains a meaningful, independent F12 guard. See `f12-mutation.log` and `f12-removed-handler.txt`.

Restored the exact commit afterward; all 60 focused unit tests passed, and both tracked worktree/index diffs were empty before cleanup.

## Exact commands

Initial scratch/dependencies:

```sh
git -C '/Users/carlwelen/Documents/ChatGPT/Booli scraper/temp' worktree add --detach /tmp/review-f21-equivalent 681cb6b335f8e839882853a248cd7a675e9adce9
cd /tmp/review-f21-equivalent/web
pnpm install --frozen-lockfile
```

The following commands ran from the scratch `web/` directory (output logs are beside this report):

```sh
TEST_DB_NAME=bostadspriser_test_r_f21eq E2E_PORT=3114 pnpm e2e:build > /tmp/r-f21-equivalent/build.log 2>&1
TEST_DB_NAME=bostadspriser_test_r_f21eq E2E_PORT=3114 pnpm exec vitest run --project unit src/components/chartAccessibility.test.tsx src/components/MobileNav.test.tsx src/components/AddressDrawer.test.ts src/components/AddressDrawer.chart.test.ts src/components/map/modalStack.test.ts > /tmp/r-f21-equivalent/unit.log 2>&1
TEST_DB_NAME=bostadspriser_test_r_f21eq E2E_PORT=3114 pnpm exec vitest run --project unit src/components/reviewerF21.test.tsx > /tmp/r-f21-equivalent/probes.log 2>&1
TEST_DB_NAME=bostadspriser_test_r_f21eq E2E_PORT=3114 pnpm exec playwright test e2e/analytics-a11y.spec.ts e2e/reviewer-f21.spec.ts e2e/granularity.spec.ts e2e/house.spec.ts > /tmp/r-f21-equivalent/e2e.log 2>&1
TEST_DB_NAME=bostadspriser_test_r_f21eq E2E_PORT=3114 pnpm exec playwright test e2e/street-search.spec.ts --grep 'native|IME' > /tmp/r-f21-equivalent/native-search.log 2>&1
```

Reversion, from the scratch root:

```sh
python3 - <<'PY_REVERT'
import subprocess
from pathlib import Path
paths=subprocess.check_output(['git','diff-tree','--no-commit-id','--name-only','-r','681cb6b']).decode().splitlines()
production=[p for p in paths if p.startswith('web/src/') and '.test.' not in p]
Path('/tmp/r-f21-equivalent/reverted-paths.txt').write_text('\n'.join(production)+'\n')
subprocess.check_call(['git','restore','--source=681cb6b^','--worktree','--',*production])
PY_REVERT
TEST_DB_NAME=bostadspriser_test_r_f21eq E2E_PORT=3114 pnpm --dir web exec vitest run --project unit src/components/chartAccessibility.test.tsx src/components/MobileNav.test.tsx src/components/AddressDrawer.test.ts src/components/AddressDrawer.chart.test.ts src/components/map/modalStack.test.ts > /tmp/r-f21-equivalent/reversion.log 2>&1
git restore --source=681cb6b --worktree -- web/src
python3 - <<'PY_MUTATE'
from pathlib import Path
p=Path('web/src/components/AddressDrawer.tsx');s=p.read_text()
start=s.index('              onBlurCapture={(event) => {')
end=s.index('\n            >',start)
Path('/tmp/r-f21-equivalent/f12-removed-handler.txt').write_text(s[start:end]+'\n')
p.write_text(s[:start]+s[end:])
PY_MUTATE
TEST_DB_NAME=bostadspriser_test_r_f21eq E2E_PORT=3114 pnpm --dir web exec vitest run --project unit src/components/AddressDrawer.chart.test.ts -t 'names the focusable|keeps a keyboard tooltip' > /tmp/r-f21-equivalent/f12-mutation.log 2>&1
git restore --source=681cb6b --worktree -- web/src/components/AddressDrawer.tsx
```

Final restoration check from `web/`:

```sh
TEST_DB_NAME=bostadspriser_test_r_f21eq E2E_PORT=3114 pnpm exec vitest run --project unit src/components/chartAccessibility.test.tsx src/components/MobileNav.test.tsx src/components/AddressDrawer.test.ts src/components/AddressDrawer.chart.test.ts src/components/map/modalStack.test.ts src/components/reviewerF21.test.tsx > /tmp/r-f21-equivalent/restored.log 2>&1
```

Independent equivalence and cleanup from scratch root/main respectively:

```sh
python3 /tmp/r-f21-equivalent/check-equivalence.py > /tmp/r-f21-equivalent/equivalence-command.log
git diff --exit-code
git diff --cached --exit-code
git -C '/Users/carlwelen/Documents/ChatGPT/Booli scraper/temp' worktree remove --force /tmp/review-f21-equivalent
```

## Reviewer probe code

`web/src/components/reviewerF21.test.tsx` (scratch only):

```tsx
// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PriceChart } from './PriceChart';
import { Histogram } from './Histogram';
import { PriceAreaScatter } from './PriceAreaScatter';

function dom(html: string) { const host = document.createElement('div'); host.innerHTML = html; return host; }
it('review: preserves empty states without exposing phantom chart tables', () => {
  for (const html of [renderToStaticMarkup(<PriceChart series={[]} />), renderToStaticMarkup(<PriceChart series={[{ name: 'ÅÄÖ', points: [] }]} />), renderToStaticMarkup(<Histogram data={[]} bucketWidth={20000} />), renderToStaticMarkup(<PriceAreaScatter data={[]} />)]) {
    const host = dom(html);
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelector('summary')).toBeNull();
    expect(host.textContent).toMatch(/Ingen data|Inga försäljningar/);
  }
});
it('review: table retains Swedish strings, escaped markup, all series and DST-adjacent months', () => {
  const name = 'S:t Åäö Éè <img src=x onerror=alert(1)>';
  const points = ['2025-03-01', '2025-10-01'].map((bucket, i) => ({ bucket, medianPricePerSqm: 123456 + i, meanPricePerSqm: 130000 + i, count: i ? 3 : 2 }));
  const host = dom(renderToStaticMarkup(<PriceChart series={[{ name, points }, { name: 'Götgatan', points: points.slice(0, 1) }]} />));
  const table = host.querySelector('table')!;
  expect(host.querySelector('img')).toBeNull();
  expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(table.textContent).toContain(name);
  expect(table.textContent).toContain('mars 2025');
  expect(table.textContent).toContain('oktober 2025');
  expect(table.textContent).toContain('123 456');
  expect(table.textContent).toContain('2 (få affärer)');
  expect(table.textContent).not.toContain('3 (få affärer)');
  expect([...table.querySelectorAll('th')].every(th => th.scope === 'col')).toBe(true);
  expect(host.querySelector('[role="region"]')?.getAttribute('tabindex')).toBe('0');
  const yearly = dom(renderToStaticMarkup(<PriceChart granularity="year" series={[{ name, points: [{ ...points[0], bucket: '2025-01-01' }] }]} />));
  expect(yearly.querySelector('tbody tr')?.children[1].textContent).toBe('2025');
});
it('review: null rooms and repeated scatter observations remain distinguishable rows', () => {
  const p = { district: 'sodermalm', areaSqm: 50.5, pricePerSqm: 120000, rooms: null };
  const host = dom(renderToStaticMarkup(<PriceAreaScatter data={[p, p, { ...p, district: 'Åäö <script>x</script>', rooms: 2.5 }]} />));
  expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(host.querySelector('script')).toBeNull();
  const cells = [...host.querySelectorAll('tbody tr:first-child td')].map(td => td.textContent);
  expect(cells).toEqual(['Södermalm', '50,5', '120 000', '—']);
});
```

`web/e2e/reviewer-f21.spec.ts` (scratch only):

```tsx
import { expect, test } from './fixtures';

test('review: keyboard disclosure and bounded chart data scroll at 320px', async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/district/ostermalm');
  await page.waitForLoadState('networkidle');
  const summary = page.locator('summary', { hasText: 'Prisutveckling – diagramdata' });
  await summary.focus();
  await page.keyboard.press('Space');
  const table = page.getByRole('table', { name: 'Prisutveckling – diagramdata', exact: true });
  await expect(table).toBeVisible();
  const region = page.getByRole('region', { name: 'Prisutveckling – diagramdata (scrolla i sidled)', exact: true });
  await page.keyboard.press('Tab');
  await expect(region).toBeFocused();
  expect(await region.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await summary.focus();
  await page.keyboard.press('Space');
  await expect(table).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test('review: insights chart tables and native data tables expose names, rows and scopes', async ({ page, consoleErrors }) => {
  await page.goto('/insights');
  await page.waitForLoadState('networkidle');
  for (const name of ['Prisfördelning per kvadratmeter', 'Yta och pris per kvadratmeter per stadsdel']) {
    await expect(page.getByRole('application', { name, exact: true })).toBeVisible();
  }
  for (const title of ['Prisfördelning – diagramdata', 'Yta och pris – diagramdata']) {
    const summary = page.locator('summary', { hasText: title });
    await summary.focus();
    await page.keyboard.press('Enter');
    const table = page.getByRole('table', { name: title, exact: true });
    await expect(table).toBeVisible();
    expect(await table.locator('tbody tr').count()).toBeGreaterThan(0);
    expect(await table.getByRole('columnheader').evaluateAll(els => els.every(el => el.getAttribute('scope') === 'col'))).toBe(true);
  }
  for (const name of ['Försäljningar per antal rum', 'Datakällornas uppdatering och täckning']) {
    await expect(page.getByRole('table', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Sidfot', exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
```

Independent equivalence checker:

```python
import subprocess
from pathlib import Path
orig='7b5e461';new='681cb6b'
def git(*args):return subprocess.check_output(['git',*args])
def paths(c):return git('diff-tree','--no-commit-id','--name-only','-r',c).decode().splitlines()
assert paths(orig)==paths(new)
lines=['PASS independent comparison: identical 24-file path list']
for p in paths(orig):
 if p=='web/src/components/AddressDrawer.chart.test.ts':continue
 old=git('diff',orig+'^',orig,'--',p).decode();cur=git('diff',new+'^',new,'--',p).decode()
 changed=lambda d:[l for l in d.splitlines() if (l.startswith(('+','-')) and not l.startswith(('+++','---'))) or l.startswith('Binary files')]
 assert changed(old)==changed(cur),p
 if p.endswith('.png'):assert git('show',orig+':'+p)==git('show',new+':'+p)
 lines.append('PASS same additions/deletions '+p)
p='web/src/components/AddressDrawer.chart.test.ts'
parent=git('show',new+'^:'+p).decode();actual=git('show',new+':'+p).decode()
original=git('show',orig+':'+p).decode();addition=original[original.index('it("names the focusable drawer chart'):].rstrip()+'\n\n'
anchor='it("keeps a keyboard tooltip mounted'
assert actual==parent.replace(anchor,addition+anchor)
lines.append('PASS resolved test is exact parent plus original F21 test before unchanged F12 keyboard test')
Path('/tmp/r-f21-equivalent/equivalence.txt').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines))
```

Cleanup completed: scratch worktree removed; report, logs, checker, and probes retained under `/tmp/r-f21-equivalent/`.
