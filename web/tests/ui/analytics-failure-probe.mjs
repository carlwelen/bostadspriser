// Run after pnpm e2e:build: node tests/ui/analytics-failure-probe.mjs.
// A separate production server uses an unreachable localhost test database;
// this verifies real Next boundaries without changing any running database.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const base = fileURLToPath(new URL("../../../", import.meta.url));
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const req = createRequire(base + '/web/package.json');
const output = fs.openSync('/tmp/e-f19-error-server.log', 'w');
const child = spawn(process.execPath, [req.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: base + '/web', stdio: ['ignore', output, output],
  env: { ...process.env, NODE_ENV: 'production', NEXT_DIST_DIR: '.next-e2e', DATABASE_URL: 'postgresql://failure:failure@127.0.0.1:1/bostadspriser_test_e?connect_timeout=1' },
});
(async () => {
  let browser;
  let exited = false;
  child.on('exit', () => { exited = true; });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (exited) throw new Error('isolated error server exited early; see /tmp/e-f19-error-server.log');
      try { ready = (await fetch(origin + '/robots.txt')).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('isolated error server did not become ready');
    browser = await chromium.launch();
    for (const [device, width, height] of [['desktop', 1280, 900], ['mobile', 412, 915]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      for (const [name, path] of [['insights', '/insights'], ['compare', '/compare?series=district:ostermalm&g=year'], ['district', '/district/ostermalm?rooms=1'], ['street', '/street/ostermalm/karlavagen'], ['house', '/street/ostermalm/karlavagen/2']]) {
        await page.goto(origin + path);
        await expect(page.getByRole('heading', { name: /Kunde inte ladda/ })).toBeVisible();
        await expect(page.locator('body')).not.toContainText('failure:failure');
        const retryResponse = page.waitForResponse((response) => response.url().includes('_rsc='));
        await page.getByRole('button', { name: 'Försök igen' }).click();
        await retryResponse;
        await expect(page.getByRole('heading', { name: /Kunde inte ladda/ })).toBeVisible();
        await expect(page).toHaveURL(origin + path);
        await page.screenshot({ path: base + '/docs/screens/F19-' + name + '-error-' + device + '.png', fullPage: true });
        console.log('PASS ' + device + ' ' + path + ' fallback, server retry, retained URL');
      }
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
    fs.closeSync(output);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
