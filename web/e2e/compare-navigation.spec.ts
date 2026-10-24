import { expect, test as base } from '@playwright/test';
import {originProxy} from '../tests/ui/originProxy';

const test = base.extend({
  proxy: async ({baseURL}, provide, testInfo) => {
    const proxy = await originProxy(new URL(baseURL!).origin, testInfo.title.includes('two additions'));
    try { await provide(proxy.options); } finally { await proxy.close(); }
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

test('annual district comparison link preserves granularity', async ({page}) => {
  await page.goto('/district/ostermalm?g=year');
  await page.getByRole('link', {name:'Jämför →', exact:true}).click();
  await expect(page).toHaveURL(/\/compare\?/);
  await expect(page).toHaveURL(/g=year/);
  await expect(page.getByRole('group', {name:'Tidsupplösning'}).getByRole('link', {name:'År', exact:true})).toHaveAttribute('aria-current', 'true');
});

test('two additions are serialized during a slow navigation and both survive', async ({page}) => {
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
  await expect(input).toBeDisabled();
  await page.keyboard.insertText('Götgatan');
  await expect(input).toHaveValue('');
  // Direct pointer events do not wait for the delayed transition to complete.
  for (const link of [
    page.getByRole('region', {name:'Snabbval'}).getByRole('link', {name:'Östermalm', exact:true}),
    page.getByRole('group', {name:'Tidsupplösning'}).getByRole('link', {name:'År', exact:true}),
  ]) {
    const box = (await link.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await expect(page.getByRole('group', {name:'Valda serier'}).getByRole('link', {name:'Ta bort Vasastan', exact:true})).toBeVisible();
  await expect(input).toBeEnabled();
  await expect(page).not.toHaveURL(/g=year/);
  await expect(page.getByRole('group', {name:'Valda serier'}).getByRole('link')).toHaveCount(1);
  await input.fill('Götgatan');
  await expect(page.getByRole('option', {name:'Götgatan (Södermalm)', exact:true})).toBeVisible();
  await page.keyboard.press('Enter');
  const selected = page.getByRole('group', {name:'Valda serier'});
  await expect(selected.getByRole('link', {name:'Ta bort Götgatan (Södermalm)', exact:true})).toBeVisible();
  await expect(selected.getByRole('link', {name:'Ta bort Vasastan', exact:true})).toBeVisible();
});

