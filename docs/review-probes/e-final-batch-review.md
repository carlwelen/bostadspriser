# Fresh adversarial review: E final batch

Immutable reviewed stack: preparation base `f125002`, then `7b5e461` (F21), `492fdc0` (F22), `b2e1923` (F23).

| Commit | Item | Verdict |
|---|---|---|
| `7b5e461` | F21 | **APPROVE** |
| `492fdc0` | F22 | **CHANGES REQUESTED** |
| `b2e1923` | F23 | **APPROVE** |

## Findings

### F22 — major: interleaved district series cause street colour collisions

`web/src/components/chartColors.ts:20`, called with the overall selected-series index by `web/src/app/compare/page.tsx:53`.

Open `/compare?series=street:ostermalm/karlavagen,district:ostermalm,district:vasastan,district:norrmalm,street:vasastan/odengatan`.
The two street series occupy positions 0 and 4 and both render `#111827` (`rgb(17, 24, 39)`). Their legend and selection-chip swatches are identical; the chart uses the same selected colours. Only two of the four street tones are needed, but modulo is applied to the total series position. This is a regression: restoring F22 production to parent `7b5e461` makes the same independent browser probe pass, with street colours `rgb(29, 78, 216)` and `rgb(159, 18, 57)`.

**Required correction:** allocate street tones by street ordinal or another collision-free assignment over the selected streets, independently of district positions. Preserve district-keyed identity. Add an interleaved two-street/three-district browser regression. An unlimited selector already exists; avoid early collisions within the available palette and provide a distinguishable fallback when tones run out.

Evidence: final colours (`/tmp/r-e-final/final-artifacts/mixed-desktop.json`), final screenshot (`/tmp/r-e-final/final-artifacts/mixed-desktop.png`), parent colours (`/tmp/r-e-final/f22-parent-artifacts/mixed-desktop.json`), parent screenshot (`/tmp/r-e-final/f22-parent-artifacts/mixed-desktop.png`). Reproduced on desktop and Pixel 7.

### F22 — minor: raw-token contrast test does not cover painted scatter contrast

`web/src/components/PriceAreaScatter.tsx:91`–94 retains `fillOpacity={0.55}` and a white outline while switching palettes. Vasastan changes from **3.99:1** composited contrast on white to **2.07:1**. Final district fills measure **2.33, 2.07, 1.95 and 1.78:1**, despite the raw-token test checking >=3:1.

**Suggested correction:** use an opaque district-coloured outline or otherwise choose opacity/fill combinations that meet the intended contrast at the rendered marks. Test computed fill, opacity and outline. This is a localized regression for Vasastan. The other three scatter categories already fell below 3:1 in the parent and should become a separate backlog item if not addressed in the F22 correction. This finding alone is not the reason for the blocking verdict.

Evidence: final composited measurements (`/tmp/r-e-final/final-artifacts/scatter-desktop.json`), parent measurements (`/tmp/r-e-final/f22-parent-artifacts/scatter-desktop.json`), probe log (`/tmp/r-e-final/probes-final.log`).

## F21 approval evidence

No blocking findings in the reviewed F21 scope. Actual browser inputs exercised:

- Space opens chart-data disclosures on district/year, street, letter-suffixed address, compare and insights pages; Tab reaches the scroll region; ArrowRight/ArrowDown scroll overflowing content. No horizontal page overflow on desktop or Pixel 7.
- Supplied same-route keyboard/native-link search selections close the mobile menu and restore focus. Independent modified-link/new-tab and different-route selections preserve navigation.
- The synthetic drawer route renders the real AddressDrawer/StreetSearch. Tab/Space changes the period, aria-pressed state and request. Nested search makes the drawer inert; Escape restores period-button focus; final Escape restores the opener and releases the scroll lock.
- Named charts, table captions/column scopes and header landmarks pass the supplied tests. Existing chart/navigation regressions are green.

**Proving test fails without fix: yes.** Restoring F21 production to `f125002` yields six focused unit failures: three missing chart/table names, missing drawer-chart name, missing pressed-button group and menu remaining expanded. All three supplied desktop accessibility browser tests fail: both same-route selections retain aria-expanded=true; named chart is absent. No import/build failure is counted as proving evidence.

Exact commands: f21-reversion.sh (`/tmp/r-e-final/f21-reversion.sh`). Output: unit (`/tmp/r-e-final/f21-parent-unit.log`), browser (`/tmp/r-e-final/f21-parent-browser.log`). The 41 unit cases marked skipped are excluded by the explicit `-t` selection; the full gate has no new skips.

## F22 proving-test evidence

**Supplied proving test fails without fix: yes.** The parent-production rebuild succeeds. The supplied colour browser test fails because Vasastan changes from `rgb(29, 78, 216)` alone to `rgb(15, 23, 42)` in a reordered comparison. Simultaneously the independent collision probe passes, proving the new collision was introduced by F22.

Commands/output: f22-reversion.sh (`/tmp/r-e-final/f22-reversion.sh`), browser log (`/tmp/r-e-final/f22-parent-browser.log`). E's DrawerTooltip delta is colour-only; no inherited F12 positioning/keyboard finding is attributed to E.

## F23 approval evidence

No findings. All supplied route-specific title, OG identity/locale/image, Twitter-card and canonical tests pass. The sitemap includes insights; the served OG image is a valid 1200×630 PNG, visually inspected as legible and unclipped. Independent requests with a real `Twitterbot/1.0` header verify address metadata inside the raw HTML head, including house `3A`. The canonical excludes query parameters. Origin normalization/validation uses the existing NEXT_PUBLIC_SITE_URL convention; no production domain is invented.

**Proving test fails without fix: yes.** Restoring F23 production to `492fdc0` and rebuilding makes compare metadata fail on the generic title and sitemap fail on the missing insights entry.

Commands/output: f23-reversion.sh (`/tmp/r-e-final/f23-reversion.sh`), parent browser log (`/tmp/r-e-final/f23-parent-browser.log`), crawler/image log (`/tmp/r-e-final/metadata-extra.log`), served image (`/tmp/r-e-final/final-artifacts/served-og-desktop.png`).

## Verification, limitations and isolation

Full unmodified `b2e1923` gate: **539 Vitest, 334 Playwright, 759 pytest pass**, plus typecheck, zero-warning lint, production build and ruff. Full log (`/tmp/r-e-final/full-gate.log`).

Independent final run: **16 pass, 4 fail**. Failures are the two F22 findings on both devices; all F21/F23 probes pass. Final log (`/tmp/r-e-final/probes-final.log`). Initial attempts are retained for transparency. Additional initial failures were probe setup issues: input before hydration; APIRequestContext incompatibility with the Chromium hermetic proxy; and a browser user-agent override not reaching the server as the intended crawler. Final probes wait for document settlement and use a direct node:http request restricted to the exact localhost origin for crawler HTML. No product changes were made to pass probes.

All production reversions were rebuilt in scratch. New unit files referring to exports absent in a parent revision were temporarily moved outside Next's TypeScript build, preserved verbatim and restored before browser execution. Browser proving tests were unchanged. Scripts preserve these steps; no production compatibility shim was used.

Main/implementer checkouts read-only. No commits/pushes, live Hemnet/Booli/Mapbox calls, protected-file access, dev DB use or unrelated process termination. Only sanctioned helpers used `bostadspriser_test_r_e_final`; port 3116. Parent owns ledger. All source changes restored and scratch removed after evidence preservation.

New backlog candidate, if not fixed with F22: rendered scatter contrast for the three categories already failing before this commit. No other new item identified in this bounded review.

## Exact independent probe source

```typescript
import { expect, test } from './fixtures';
import { writeFileSync } from 'node:fs';
import { get } from 'node:http';

const mixed = 'street:ostermalm/karlavagen,district:ostermalm,district:vasastan,district:norrmalm,street:vasastan/odengatan';
test('review F22: two streets among five series have distinct visual identities', async ({page, consoleErrors}, info) => {
  await page.goto(`/compare?series=${mixed}`);
  const legend = page.getByRole('list', {name:'Diagramförklaring'});
  await expect(legend.getByRole('listitem')).toHaveCount(5);
  const colors = await legend.getByRole('listitem').evaluateAll(items => items.map(item => ({name:item.textContent, color:getComputedStyle(item.querySelector('span')!).backgroundColor})));
  writeFileSync(`/tmp/r-e-final/mixed-${info.project.name}.json`, JSON.stringify(colors,null,2));
  await page.screenshot({path:`/tmp/r-e-final/mixed-${info.project.name}.png`,fullPage:true});
  expect(consoleErrors).toEqual([]);
  expect(colors[0].color).not.toBe(colors[4].color);
});

test('review F22: actual scatter fills retain graphical-object contrast', async ({page}, info) => {
  await page.goto('/insights');
  const scatter = page.getByRole('group',{name:'Yta och pris per kvadratmeter per stadsdel'});
  await expect(scatter.locator('.recharts-scatter-symbol path').first()).toBeVisible();
  const colors = await scatter.locator('.recharts-scatter-symbol path').evaluateAll(paths => [...new Set(paths.map(p => `${getComputedStyle(p).fill}|${getComputedStyle(p).fillOpacity}`))].map(value => {
    const [fill,alpha] = value.split('|');
    const rgb=fill.match(/\d+/g)!.map(Number), a=Number(alpha);
    const composite=rgb.map(c=>a*c+(1-a)*255);
    const linear=composite.map(c=>c/255<=0.04045?c/255/12.92:((c/255+0.055)/1.055)**2.4);
    return {fill,alpha,contrast:1.05/(linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722+0.05)};
  }));
  writeFileSync(`/tmp/r-e-final/scatter-${info.project.name}.json`,JSON.stringify(colors,null,2));
  for(const color of colors) expect.soft(color.contrast,JSON.stringify(color)).toBeGreaterThanOrEqual(3);
});

for(const path of ['/district/ostermalm?g=year','/street/vasastan/odengatan','/street/ostermalm/karlavagen/3A','/compare','/insights']) {
  test(`review F21: keyboard opens and scrolls every data table on ${path}`, async ({page,consoleErrors},info)=>{
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const disclosures=page.locator('summary');
    expect(await disclosures.count()).toBeGreaterThan(0);
    for(let i=0;i<await disclosures.count();i++){
      const summary=disclosures.nth(i);
      await summary.focus();
      await page.keyboard.press('Space');
      const details=summary.locator('..');
      await expect(details).toHaveAttribute('open','');
      const table=details.getByRole('table');
      await expect(table).toBeVisible();
      expect(await table.getByRole('row').count()).toBeGreaterThan(1);
      await page.keyboard.press('Tab');
      const region=details.getByRole('region');
      await expect(region).toBeFocused();
      const dimensions=await region.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,scrollHeight:el.scrollHeight}));
      if(dimensions.scroll>dimensions.width){await page.keyboard.press('ArrowRight');await expect.poll(()=>region.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);}
      if(dimensions.scrollHeight>dimensions.height){await page.keyboard.press('ArrowDown');await expect.poll(()=>region.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);}
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }
    if(path.includes('g=year')) await expect(page.getByRole('table',{name:'Prisutveckling – diagramdata',exact:true})).toContainText('2025');
    await page.screenshot({path:`/tmp/r-e-final/tables-${path.replace(/[^a-z0-9]/gi,'-')}-${info.project.name}.png`,fullPage:true});
    expect(consoleErrors).toEqual([]);
  });
}

test('review F21: search different-route and modified-link selections preserve navigation',async({page,context,consoleErrors})=>{
  await page.setViewportSize({width:412,height:915});
  await page.goto('/street/ostermalm/karlavagen');
  await page.waitForLoadState('networkidle');
  const menu=page.getByRole('button',{name:'Meny'});
  await menu.click();await page.getByRole('navigation',{name:'Huvudmeny'}).getByRole('button',{name:'Sök gata'}).click();
  await page.getByRole('combobox').fill('Odengatan');
  const link=page.getByRole('option').first().getByRole('link');
  await expect(link).toHaveAttribute('href','/street/vasastan/odengatan');
  const popupPromise=context.waitForEvent('page');
  await link.click({modifiers:['ControlOrMeta']});
  const popup=await popupPromise;await popup.waitForLoadState();
  expect(popup.url()).toContain('/street/vasastan/odengatan');await popup.close();
  await expect(page.getByRole('dialog',{name:'Sök gata'})).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded','true');
  await page.getByRole('combobox').press('Enter');
  await expect(page).toHaveURL(/\/street\/vasastan\/odengatan$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(menu).toHaveAttribute('aria-expanded','false');
  expect(consoleErrors).toEqual([]);
});

test('review F21: actual drawer filter keyboard state, modal stack and focus return',async({page,consoleErrors})=>{
  await page.route('**/api/address?*',async route=>{
    const period=new URL(route.request().url()).searchParams.get('period');
    await route.fulfill({json:{district:'ostermalm',street:'Karlavägen',house:'10',period,granularity:'month',streetSeries:[{bucket:'2025-06-01',meanPricePerSqm:140000,medianPricePerSqm:145000,count:3}],addressSales:[{soldAt:'2025-06-20',priceSek:3900000,pricePerSqmSek:130000,sources:['hemnet']}]}});
  });
  await page.goto('/review-drawer');
  const opener=page.getByRole('button',{name:'Öppna adress'});
  await opener.focus();await page.keyboard.press('Enter');
  const drawer=page.getByRole('dialog',{name:'Karlavägen 10',exact:true});
  await expect(drawer).toBeFocused();await expect(drawer).toHaveAttribute('aria-modal','true');
  const group=drawer.getByRole('group',{name:'Tidsperiod'});
  await expect(group.getByRole('button',{name:'12 mån'})).toHaveAttribute('aria-pressed','true');
  await drawer.getByRole('button',{name:'Stäng',exact:true}).focus();
  await page.keyboard.press('Tab');await expect(group.getByRole('button',{name:'30 dagar'})).toBeFocused();
  const request=page.waitForRequest(req=>req.url().includes('/api/address?')&&req.url().includes('period=30d'));
  await page.keyboard.press('Space');await request;
  await expect(group.getByRole('button',{name:'30 dagar'})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Tab');await expect(group.getByRole('button',{name:'3 mån'})).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(drawer).toHaveAttribute('inert','');
  await expect(page.getByRole('dialog',{name:'Sök gata'}).getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(group.getByRole('button',{name:'3 mån'})).toBeFocused();
  const full=drawer.getByRole('link',{name:'Öppna full sida'});await full.focus();await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button',{name:'Stäng',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);await expect(opener).toBeFocused();
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  expect(consoleErrors).toEqual([]);
});

test('review F23: crawler gets complete head metadata, letter house canonical and image',async({page,baseURL},info)=>{
  const target=new URL('/street/ostermalm/karlavagen/3A?g=year',baseURL);
  expect(target.origin).toBe('http://127.0.0.1:3116');
  const response=await new Promise<{status:number;html:string}>((resolve,reject)=>{
    get(target,{headers:{'User-Agent':'Twitterbot/1.0'}},res=>{let html='';res.setEncoding('utf8');res.on('data',chunk=>html+=chunk);res.on('end',()=>resolve({status:res.statusCode!,html}));res.on('error',reject);}).on('error',reject);
  });
  expect(response.status).toBe(200);
  writeFileSync(`/tmp/r-e-final/crawler-${info.project.name}.html`,response.html);
  const head=response.html.split('</head>')[0];
  expect(head).toContain('Karlavägen 3A, Östermalm — bostadspriser');
  expect(head).toContain('property="og:title"');expect(head).toContain('name="twitter:card"');
  await page.setExtraHTTPHeaders({});
  await page.goto('/street/ostermalm/karlavagen/3A?g=year');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','http://localhost:3000/street/ostermalm/karlavagen/3A');
  const src=await page.locator('meta[property="og:image"]').first().getAttribute('content');
  const image=(await page.goto(new URL(src!).pathname))!;
  expect(image.status()).toBe(200);expect(image.headers()['content-type']).toContain('image/png');
  writeFileSync(`/tmp/r-e-final/served-og-${info.project.name}.png`,await image.body());
});

```

Synthetic fixture route:

```tsx
'use client';
import {useState} from 'react';
import {AddressDrawer} from '@/components/AddressDrawer';
import {StreetSearch} from '@/components/StreetSearch';
export default function Probe(){const [open,setOpen]=useState(false);return <main><button onClick={()=>setOpen(true)}>Öppna adress</button><StreetSearch/><AddressDrawer onClose={()=>setOpen(false)} selection={open?{district:'ostermalm',street:'Karlavägen',houseNumber:'10',address:'Karlavägen 10',pricePerSqm:130000,soldAt:'2025-06-20',sources:['hemnet']}:null}/></main>}

```
