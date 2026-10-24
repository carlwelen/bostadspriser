import { test, expect } from '../e2e/fixtures';
import fs from 'node:fs';
test.beforeEach(async({consoleErrors})=>{expect(consoleErrors).toEqual([]);});
test.afterEach(async({consoleErrors})=>{expect(consoleErrors).toEqual([]);});
const base = {district:'ostermalm',street:'Karlavägen',house:'10',period:'12mo',granularity:'month',streetSummary:{count:777,medianPricePerSqm:117000,meanPricePerSqm:200000,earliest:'2026-05-01',latest:'2026-09-01'},streetSeries:[
 {bucket:'2026-05-01',meanPricePerSqm:140000,medianPricePerSqm:145000,count:1},
 {bucket:'2026-06-01',meanPricePerSqm:150000,medianPricePerSqm:155000,count:4},
 {bucket:'2026-08-01',meanPricePerSqm:140000,medianPricePerSqm:145000,count:2},
 {bucket:'2026-09-01',meanPricePerSqm:150000,medianPricePerSqm:155000,count:4}],addressSales:[
 {soldAt:'2026-06-20',priceSek:3900000,pricePerSqmSek:130000,sources:['hemnet']},
 {soldAt:'2026-06-03',priceSek:3600000,pricePerSqmSek:120000,sources:['booli']},
 {soldAt:'2026-06-02',priceSek:3000000,pricePerSqmSek:100000,sources:['hemnet']}]};
test('review drawer real geometry and tooltip containment', async({page},info)=>{
 await page.route('**/api/address*',r=>r.fulfill({json:base}));
 await page.goto('/drawer-review-fixture');
 const dots=page.locator('.recharts-scatter-symbol path');
 await expect(dots).toHaveCount(3);await page.waitForTimeout(1700);
 const coords=await dots.evaluateAll(es=>es.map(e=>[Number(e.getAttribute('cx')),Number(e.getAttribute('cy'))]));
 const xs=coords.map(c=>c[0]).sort((a,b)=>a-b);expect((xs[1]-xs[0])/(xs[2]-xs[0])).toBeCloseTo(1/18,5);
 expect((await page.locator('.recharts-area-curve').getAttribute('d'))!.match(/M/g)).toHaveLength(2);
 const street=page.locator('.recharts-area-dots circle');await expect(street).toHaveCount(4);
 const bounds=[];
 for(let i=0;i<4;i++){
  await street.nth(i).hover({force:true});const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();
  await expect(tip).toContainText(base.streetSeries[i].count+' försäljning');
  const t=(await tip.boundingBox())!;const d=(await page.getByRole('dialog',{name:'Karlavägen 10'}).boundingBox())!;
  bounds.push({i,t,d});expect(t.x).toBeGreaterThanOrEqual(d.x);expect(t.x+t.width).toBeLessThanOrEqual(d.x+d.width);
 }
 for(let i=0;i<3;i++){await dots.nth(i).hover({force:true});await expect(page.getByRole('tooltip')).toContainText('1 försäljning');}
 fs.writeFileSync('/tmp/d-f12-dense-drawer-'+info.project.name+'.json',JSON.stringify(bounds));
 await page.screenshot({path:'/tmp/d-f12-dense-drawer-'+info.project.name+'.png',fullPage:true});
});
for (const height of [400, 320, 240]) for (const count of [2]) test(`review ${count} same-day sales fit at height ${height}`,async({page},info)=>{
 await page.setViewportSize({width:1280,height});
 const data={...base,streetSeries:[base.streetSeries[1]],addressSales:Array.from({length:count},(_,i)=>({...base.addressSales[0],soldAt:'2026-06-01',pricePerSqmSek:100000+i*1000}))};
 await page.route('**/api/address*',r=>r.fulfill({json:data}));await page.goto('/drawer-review-fixture');
 const dots=page.locator('.recharts-scatter-symbol path');await expect(dots).toHaveCount(count);await page.waitForTimeout(1700);
 await dots.first().hover({force:true});const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();
 await expect(tip).toContainText(String(99+count));const box=(await tip.boundingBox())!;
 fs.writeFileSync('/tmp/d-f12-dense-sameday-'+info.project.name+'.json',JSON.stringify({box,viewport:page.viewportSize()}));
 await page.screenshot({path:'/tmp/d-f12-dense-sameday-'+info.project.name+'.png',fullPage:true});
 const panel=(await page.getByRole('dialog').boundingBox())!;
 const clip=await tip.evaluate(e=>{
   let p=e.parentElement;
   while(p && !/auto|scroll/.test(getComputedStyle(p).overflowY)) p=p.parentElement;
   return p!.getBoundingClientRect().toJSON();
 });
 expect(box.y).toBeGreaterThanOrEqual(clip.y);
 expect(box.y+box.height).toBeLessThanOrEqual(clip.y+clip.height);
 expect(box.y).toBeGreaterThanOrEqual(panel.y);
 expect(box.y+box.height).toBeLessThanOrEqual(Math.min(page.viewportSize()!.height,panel.y+panel.height));
 await tip.hover({timeout:3000});
 await page.mouse.wheel(0,1200);
 await expect.poll(()=>tip.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 await expect(tip).toContainText(String(99+count));
 await tip.click({position:{x:8,y:8}});
 await expect(tip).toBeFocused();
 await page.keyboard.press('Home');
 await expect.poll(()=>tip.evaluate(e=>e.scrollTop)).toBe(0);
 await page.keyboard.press('End');
 await expect.poll(()=>tip.evaluate(e=>Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop))).toBeLessThan(2);
 const last=await tip.locator('div').last().boundingBox();
 const current=(await tip.boundingBox())!;
 expect(last!.y+last!.height).toBeLessThanOrEqual(current.y+current.height);
 if (info.project.name === 'mobile') {
   await page.keyboard.press('Home');
   await expect.poll(()=>tip.evaluate(e=>e.scrollTop)).toBe(0);
   const session=await page.context().newCDPSession(page);
   const touchBox=(await tip.boundingBox())!;
   const x=touchBox.x+touchBox.width/2, y=touchBox.y+touchBox.height-20;
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=8;step++) {
     await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*12}]});
     await page.waitForTimeout(20);
   }
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await expect.poll(()=>tip.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
   await expect(tip).toContainText(String(99+count));
   await session.detach();
   await tip.focus();
   await page.keyboard.press('End');
   await expect.poll(()=>tip.evaluate(e=>Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop))).toBeLessThan(2);
 }
 await page.screenshot({path:`../docs/screens/F12-short-${height}-${info.project.name}.png`,fullPage:true});
});

test('scroll access follows a live viewport resize',async({page})=>{
 await page.setViewportSize({width:1280,height:720});
 // Other dates leave enough drawer content to keep the hovered point inside the resized viewport.
 const data={...base,streetSeries:[base.streetSeries[1]],addressSales:[
  ...Array.from({length:2},(_,i)=>({...base.addressSales[0],soldAt:'2026-06-01',pricePerSqmSek:100000+i*1000})),
  ...Array.from({length:4},(_,i)=>({...base.addressSales[0],soldAt:`2026-05-0${i+1}`})),
 ]};
 await page.route('**/api/address*',r=>r.fulfill({json:data}));
 await page.goto('/drawer-review-fixture');
 const dots=page.locator('.recharts-scatter-symbol path');
 await expect(dots).toHaveCount(6);await page.waitForTimeout(1700);
 await page.getByRole('dialog').hover();await page.mouse.wheel(0,250);
 await expect.poll(async()=> (await dots.first().boundingBox())!.y).toBeLessThan(390);
 await dots.first().hover({force:true});
 const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();
 expect(await tip.evaluate(e=>e.scrollHeight<=e.clientHeight)).toBe(true);
 await page.setViewportSize({width:1280,height:400});
 await tip.focus();
 await expect.poll(()=>tip.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
 await tip.hover({timeout:3000});await page.mouse.wheel(0,400);
 await expect.poll(()=>tip.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 await page.keyboard.press('End');
 await expect.poll(()=>tip.evaluate(e=>Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop))).toBeLessThan(2);
});
