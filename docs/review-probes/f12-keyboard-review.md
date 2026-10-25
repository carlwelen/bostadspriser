# F12 fresh review — CHANGES REQUESTED

Source: `a8789bd0f2932efd7dadb4692293ab4a8cb48e60` (cumulative F12 `c0553f8`, `717df2f`, `a8789bd`; F11/B14 checked for regressions).

## Major — keyboard users cannot enter the scrollable tooltip

- Location: `web/src/components/map/DrawerTooltip.tsx:65` (`tabIndex={0}`) and `web/src/components/AddressDrawer.tsx:244` (uncontrolled Recharts tooltip).
- Scenario: 20 same-day sales; navigate with Tab from the drawer through its controls into the SVG application, then ArrowRight. The tooltip appears with the correct SQL count. It precedes the SVG in DOM order, so Shift+Tab is the applicable entry direction. Shift+Tab removes the tooltip and leaves `document.activeElement` equal to BODY, on both Desktop Chrome and Pixel 7. End cannot scroll to the hidden records. Forward Tab instead legitimately goes to “Öppna full sida”; that direction alone is not the finding.
- Cause: the Recharts wrapper handles bubbling blur unconditionally, disabling the keyboard tooltip when focus moves from the SVG to the tooltip. Its focus handler does not restore an existing keyboard index. Adding tabindex and preventing scrolling-key propagation does not preserve the tooltip during this internal focus transfer.
- Fix: retain active tooltip content while focus transfers between the chart and its scrollable content, with a usable keyboard entry/exit path. Allow ordinary exit and Escape; do not steal focus during hover. Add a browser regression that opens the tooltip solely with keyboard input, enters its content through the real tab order, scrolls to the last record, and exits.
- Evidence: `keyboard-access.log` (2/2 fail), `shift-tab-desktop.json`, `shift-tab-mobile.json`, and `keyboard-traces/`. Both JSON snapshots show BODY active and no tooltip. Supplied tests first activate using mouse hover and then click/focus the tooltip, so they do not cover this path.

This is unfinished F12 acceptance, not a new backlog ID. The bounding correction in a8789bd is effective, but the cumulative F12 stack is not ready to merge.

## Verification

- Supplied dense/short/resize probes: 18/18 pass, including 8/20/200 records, heights 400/320/240, wheel, touch, Home/End, numeric elapsed-time spacing, missing-bucket line breaks, sparse dots, and viewport/drawer containment. `browser-green.log`.
- Independent hover/resize/no-focus-steal checks pass on desktop/mobile at 320px width and after expansion. `browser-independent-refined.log` records those two passing cases. Its forward-Tab expectation was exploratory and is superseded by the exact Shift+Tab finding; its additional resize/scroll experiment is not a separate classified finding.
- Focused source unit tests and independently added observer/listener cleanup test: 15 pass after restoring the immutable source. `unit-final.log`. Cleanup checks date changes, inactive state and unmount, including exact window and visualViewport listener removal and ResizeObserver disconnect.
- Real SQL integration: 20 pass. `sql-green.log`. The street count is COUNT(*) in `aggregations.ts:904`, mapped directly to `count` at :922 and displayed directly from the matching SQL bucket; no new UI aggregation. Median and summary tests remain green.
- No full gate rerun was needed for this read-only review; source full gate was reported separately by root. Browser console/page-error assertions passed in all completed probes, including failed focus assertions.

## Meaningful production reversions

- Restore `AddressDrawer.tsx` and `drawerSeries.ts` from `c0553f8^`; run `pnpm exec vitest run src/components/AddressDrawer.chart.test.ts -t F12`: 2 intended failures (no sparse street dots; missing custom tooltip/count). `c055-reversion.log`.
- Restore `DrawerTooltip.tsx` from `717df2f^`; run its keyboard unit test: fails because the old tooltip cannot receive focus. `717-reversion.log`.
- Restore `DrawerTooltip.tsx` from `717df2f`, rebuild using the normal e2e build, then run desktop short probes at 400/240 plus live resize: 3 intended failures: tooltip top is clipped above the scroll area at both heights, and the resized two-record tooltip cannot receive hover/wheel input. `a878-reversion.log` and `a878-reversion-traces/`. Source restored afterward.

## Reproduction files

Use `probes/page.tsx` as the temporary `web/src/app/drawer-review-fixture/page.tsx`; copy `probes/f12-keyboard-access-review.spec.ts` to `web/screens/`. Run a hermetic build and `TEST_DB_NAME=bostadspriser_test_r_f12 E2E_PORT=3117 pnpm screens f12-keyboard-access-review.spec.ts`. Other supplied/adversarial specs and the cleanup unit test are preserved under `probes/`. No production fixture route is retained.

Exact minimal keyboard probe:

```ts
import { test, expect } from '../e2e/fixtures';
import fs from 'node:fs';
const data = {district:'ostermalm',street:'Karlavägen',house:'10',period:'12mo',granularity:'month',streetSeries:[
 {bucket:'2026-06-01',meanPricePerSqm:150000,medianPricePerSqm:155000,count:37}],addressSales:Array.from({length:20},(_,i)=>({soldAt:'2026-06-01',priceSek:3000000,pricePerSqmSek:100000+i*1000,sources:['hemnet']}))};
test.afterEach(async ({consoleErrors})=>expect(consoleErrors).toEqual([]));
async function open(page: import('@playwright/test').Page) {
 await page.route('**/api/address*',r=>r.fulfill({json:data}));
 await page.goto('/drawer-review-fixture');
 await expect(page.locator('.recharts-scatter-symbol path')).toHaveCount(20);
 await page.waitForTimeout(1700);
}
test('keyboard-only Shift+Tab can enter the preceding tooltip and scroll',async({page},info)=>{
 await open(page);const chart=page.getByRole('application');
 for(let n=0;n<8 && !(await chart.evaluate(e=>e===document.activeElement));n++)await page.keyboard.press('Tab');
 await expect(chart).toBeFocused();await page.keyboard.press('ArrowRight');
 const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();
 await page.keyboard.press('Shift+Tab');await page.waitForTimeout(100);
 const state=await page.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,400),tooltip:!!document.querySelector('[role=tooltip]')}));
 fs.writeFileSync('/tmp/r-f12-correction/shift-tab-'+info.project.name+'.json',JSON.stringify(state));
 await expect(tip).toBeFocused();
 await page.keyboard.press('End');await expect.poll(()=>tip.evaluate(e=>Math.abs(e.scrollHeight-e.scrollTop-e.clientHeight))).toBeLessThan(2);
 await page.keyboard.press('Tab');await expect(chart).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
```
