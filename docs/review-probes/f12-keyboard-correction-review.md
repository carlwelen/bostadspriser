# F12 cumulative fresh review — APPROVE

Reviewed immutable source `e8b0b04ba5628cad481ad89eda7677e409a52b91`, branch `hardening/d-map-phase3`.

| Commit | Verdict |
|---|---|
| `c0553f8` — counts and sparse buckets | APPROVE |
| `717df2f` — dense tooltip scrolling | APPROVE |
| `a8789bd` — visible scroll-area bounds | APPROVE |
| `e8b0b04` — keyboard focus transfer | APPROVE |

No blocker or major finding remains in this F12 stack. The earlier keyboard-only entry failure is fixed: natural Tab reaches the real Recharts SVG, ArrowRight activates the tooltip, and Shift+Tab preserves its DOM node and focus. Both exit directions dismiss it normally; re-entry, Escape and opener-focus restoration work. Hover does not steal focus.

## Independent verification

- **32 passing production-browser cases** on Desktop Chrome and Pixel 7: 24 supplied keyboard/dense/short/resize cases; six independent stress cases; two independent multi-date cases. The stress cases visibly reach **every one of 200 records** using keyboard scrolling at 320×240 and 1280×400, then verify Home, outward Tab/Shift+Tab and re-entry. A focused tooltip survives viewport collapse/expansion. Multi-date keyboard traversal reaches every actual date, preserves the matching SQL n and median, and does not invent a tooltip for a missing bucket.
- Dense fixtures cover 8/20/200 same-day records, wheel/touch scrolling, sparse-ring rendering, elapsed-time spacing and missing-bucket line breaks. Short fixtures cover heights 400/320/240. Screenshots inspected, including short-height and mobile keyboard captures.
- **15 focused unit tests pass**, including real Recharts, same-day counts, medians, gaps and exact focus transfer. Repeated after restoring immutable production files.
- **20 real SQL integration tests pass**: address periods, uncapped street summary and median/count contracts. `aggregations.ts:904` still computes `COUNT(*)`, `:922` maps it directly to `count`, and the matching tooltip bucket displays it directly. Median remains SQL-derived.
- The initial production build passed build/type/lint checks. A full `scripts/check.sh` was not rerun for this read-only review; the implementer's reported full-gate counts were not used as proof.

Logs: `unit-green.log`, `unit-restored.log`, `sql-green.log`, `build-green.log`, `browser-green.log`, `browser-settled.log`, `browser-multidate-final.log` in this directory. `browser-green.log` also records four exploratory stress failures: Home was issued during ongoing keyboard scrolling, and End immediately during a resize. All six stress cases pass with a 300 ms settling interval. Two standalone native-scroll characterization cases also pass. Earlier multi-date probe failures assumed chronological keyboard order; the final probe checks all actual dates without that unsupported assumption. All exploratory logs/traces are retained.

## Meaningful production reversions

All commands used `TEST_DB_NAME=bostadspriser_test_r_f12_final E2E_PORT=3117` in the scratch worktree. Only production files were reverted; final tests were retained.

1. Restore `AddressDrawer.tsx` and `drawerSeries.ts` from `c0553f8^`; run `pnpm exec vitest run src/components/AddressDrawer.chart.test.ts -t 'sparse street|visible tooltip'`: **2 intended failures**, missing sparse street dots and missing custom tooltip/count. `c055-reversion.log`.
2. Restore `DrawerTooltip.tsx` from `717df2f^`; run `pnpm exec vitest run src/components/map/DrawerTooltip.keyboard.test.ts`: **1 intended failure**, tooltip cannot receive focus. `717-reversion.log`.
3. Restore `DrawerTooltip.tsx` from `717df2f`, rebuild using `pnpm e2e:build`, then `pnpm screens drawer-short.spec.ts --project=desktop --grep 'height 400|height 240|live viewport resize'`: **3 intended failures**, tooltip clipped above the drawer scroll area at both heights and SVG intercepting pointer input after resize. `a878-browser-reversion.log`, `a878-reversion-traces/`.
4. Restore only `AddressDrawer.tsx` from `e8b0b04^`; the new unit test fails when focus enters the tooltip (`e8-unit-reversion.log`). Rebuild and run `pnpm screens drawer-keyboard.spec.ts --grep 'keyboard-only tooltip entry'`: **2 intended failures**, tooltip disappears immediately after real Shift+Tab on desktop and mobile. `e8-browser-reversion.log`, `e8-reversion-traces/`.

Immutable production files were restored and compared against `e8b0b04`; the restored unit suite passes. No source/main edits, commits, pushes, live providers or protected paths were involved. Scratch `/tmp/review-f12-keyboard-final` removed after completion. Probes and artifacts remain here.

## Separate minor follow-up candidate

`web/src/components/AddressDrawer.tsx:257` / `:268`: Recharts keyboard arrows traverse per-series source order rather than chronological x order. With May/June/August/September street buckets plus June address dates, the next keyboard index after June's bucket is the inserted July gap, before the June address observations. Every actual date remains reachable with correct counts; plotted x positions remain correct. This is inherited chart behavior, independent of the e8 focus correction, and does not block F12. A separate accessibility follow-up could order keyboard navigation by the union of actual dates while preserving individual observations and missing-bucket line breaks.

## Reproduction and independent probes

Use `probes/page.tsx` as temporary `web/src/app/drawer-review-fixture/page.tsx`, copy desired specs to `web/screens`, then run the normal hermetic production build and `pnpm screens <spec>` with the isolated DB/port above. Supplied probes are retained alongside the independent probes. Temporary fixture routes/specs were never committed.

Independent final stress probe:

```ts
import type { Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';

const makeData = (count:number) => ({district:'ostermalm',street:'Karlavägen',house:'10',period:'12mo',granularity:'month',
 streetSeries:[{bucket:'2026-06-01',meanPricePerSqm:150000,medianPricePerSqm:155000,count:37}],
 addressSales:Array.from({length:count},(_,i)=>({soldAt:'2026-06-01',priceSek:3000000,pricePerSqmSek:100000+i*1000,sources:['hemnet']}))});
test.afterEach(async({consoleErrors}) => expect(consoleErrors).toEqual([]));
async function keyboardOpen(page:Page, count:number) {
 await page.route('**/api/address*',r=>r.fulfill({json:makeData(count)}));
 await page.goto('/drawer-review-fixture');
 await expect(page.locator('.recharts-scatter-symbol path')).toHaveCount(count);
 await page.waitForTimeout(1700);
 const chart=page.getByRole('application');
 for(let n=0;n<8 && !(await chart.evaluate(e=>e===document.activeElement));n++) await page.keyboard.press('Tab');
 await expect(chart).toBeFocused();
 await page.keyboard.press('ArrowRight');
 const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();
 await page.keyboard.press('Shift+Tab');await expect(tip).toBeFocused();
 return {chart,tip};
}
for(const size of [{width:320,height:240},{width:1280,height:400}]) test(`independent keyboard reaches every one of 200 records at ${size.width}x${size.height}`,async({page})=>{
 await page.setViewportSize(size);
 const {chart,tip}=await keyboardOpen(page,200);
 await expect(tip).toContainText('Gatans median: 155\u00a0000 kr/m²');
 await expect(tip).toContainText('Medel: 150\u00a0000 kr/m²');
 await expect(tip).toContainText('37 försäljningar');
 await expect(tip.locator('div')).toHaveCount(201);
 const seen=new Set<number>();
 for(let step=0;step<400;step++) {
  const state=await tip.evaluate(e=>{
   const tip=e.getBoundingClientRect();
   let clip=e.parentElement;
   while(clip&&!/auto|scroll|hidden|clip/.test(getComputedStyle(clip).overflowY)) clip=clip.parentElement;
   const bounds=clip!.getBoundingClientRect();
   return {tip:tip.toJSON(),bounds:bounds.toJSON(), bottom:e.scrollTop+e.clientHeight>=e.scrollHeight-2,
    visible:Array.from(e.querySelectorAll(':scope > div')).map((el,i)=>({i,r:el.getBoundingClientRect()})).filter(({r})=>r.top>=tip.top&&r.bottom<=tip.bottom).map(({i})=>i)};
  });
  expect(state.tip.top).toBeGreaterThanOrEqual(state.bounds.top);
  expect(state.tip.bottom).toBeLessThanOrEqual(state.bounds.bottom);
  state.visible.forEach(i=>seen.add(i));
  if(state.bottom) break;
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(50);
 }
 expect(seen.size).toBe(201);
 await expect(tip).toBeFocused();
 await page.waitForTimeout(300);await page.keyboard.press('Home');await expect.poll(()=>tip.evaluate(e=>e.scrollTop)).toBe(0);
 await page.keyboard.press('Tab');await expect(chart).toBeFocused();await expect(tip).toHaveCount(0);
 await page.keyboard.press('ArrowRight');await expect(tip).toBeVisible();
 await page.keyboard.press('Shift+Tab');await expect(tip).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(page.getByRole('tab',{name:'Allt',exact:true})).toBeFocused();await expect(tip).toHaveCount(0);
});

test('independent focused keyboard tooltip survives viewport collapse and expansion',async({page})=>{
 await page.setViewportSize({width:1280,height:720});
 const {chart,tip}=await keyboardOpen(page,20);
 for(const size of [{width:320,height:240},{width:390,height:720},{width:1280,height:900}]) {
  await page.setViewportSize(size);await page.waitForTimeout(300);await expect(tip).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(()=>tip.evaluate(e=>Math.abs(e.scrollHeight-e.scrollTop-e.clientHeight))).toBeLessThan(2);
  const b=(await tip.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(size.width);
  expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height).toBeLessThanOrEqual(size.height);
  await page.waitForTimeout(300);await page.keyboard.press('Home');await expect.poll(()=>tip.evaluate(e=>e.scrollTop)).toBe(0);
 }
 await page.keyboard.press('Tab');await expect(chart).toBeFocused();
});

```

Independent final multi-date probe:

```ts
import {test,expect} from '../e2e/fixtures';
test.afterEach(async({consoleErrors})=>expect(consoleErrors).toEqual([]));
test('keyboard visits each actual date and gap without confusing SQL bucket counts',async({page})=>{
 const data={district:'ostermalm',street:'Karlavägen',house:'10',period:'12mo',granularity:'month',streetSeries:[
  {bucket:'2026-05-01',meanPricePerSqm:140000,medianPricePerSqm:145000,count:1},
  {bucket:'2026-06-01',meanPricePerSqm:150000,medianPricePerSqm:155000,count:37},
  {bucket:'2026-08-01',meanPricePerSqm:140000,medianPricePerSqm:145000,count:2},
  {bucket:'2026-09-01',meanPricePerSqm:150000,medianPricePerSqm:155000,count:4}],
  addressSales:['2026-06-20','2026-06-03','2026-06-02'].map(soldAt=>({soldAt,priceSek:3900000,pricePerSqmSek:130000,sources:['hemnet']}))};
 await page.route('**/api/address*',r=>r.fulfill({json:data}));await page.goto('/drawer-review-fixture');
 await expect(page.locator('.recharts-scatter-symbol path')).toHaveCount(3);await page.waitForTimeout(1700);
 const chart=page.getByRole('application');
 for(let n=0;n<8&&!(await chart.evaluate(e=>e===document.activeElement));n++)await page.keyboard.press('Tab');
 await expect(chart).toBeFocused();
 const seen=new Set<string>();
 for(let step=0;step<12&&seen.size<7;step++){
  if(step>0) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const tip=page.getByRole('tooltip');
  if(await tip.count()===0)continue;
  const date=(await tip.locator(':scope > p').first().textContent())!;
  seen.add(date);
  const street=data.streetSeries.find(s=>s.bucket===date);
  await expect(tip).toContainText(`${street?.count??1} försäljning`);
  if(street)await expect(tip).toContainText(`Gatans median: ${new Intl.NumberFormat('sv-SE').format(street.medianPricePerSqm)} kr/m²`);
  await page.keyboard.press('Shift+Tab');await expect(tip).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(tip).toContainText(date);
  await page.keyboard.press('Tab');await expect(chart).toBeFocused();await expect(tip).toHaveCount(0);
 }
 expect([...seen].sort()).toEqual(['2026-05-01','2026-06-01','2026-06-02','2026-06-03','2026-06-20','2026-08-01','2026-09-01']);
});

```
