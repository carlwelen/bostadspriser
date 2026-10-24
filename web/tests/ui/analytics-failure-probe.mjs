// Run after a seeded e2e run: TEST_DB_NAME=bostadspriser_test_e node tests/ui/analytics-failure-probe.mjs.
// Run alone: the transient failure renames a view in this guarded test database.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { originProxy } from "./originProxy.ts";

const base = fileURLToPath(new URL("../../../", import.meta.url));
const req = createRequire(base + "web/package.json");
const { testDatabaseUrl } = req("./scripts/test-db.cjs");
const databaseUrl = testDatabaseUrl();
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
let child, browser, proxy, output;
let renamed = false;
try {
  const [{ name }] = await prisma.$queryRawUnsafe("SELECT current_database() AS name");
  if (!/(^|_)test(_|$)/.test(name) || name !== new URL(databaseUrl).pathname.slice(1)) {
    throw new Error("Refusing transient failure outside the configured test database");
  }
  const fixtureStreets = await prisma.listing.findMany({
    where: { street: { in: ["Karlavägen", "Götgatan"] } }, distinct: ["street"], select: { street: true },
  });
  if (fixtureStreets.length !== 2) throw new Error("Seed the shared e2e fixture before running this probe; the scraper gate leaves a different dataset");
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  output = fs.openSync("/tmp/e-f19-error-server.log", "w");
  child = spawn(process.execPath, [req.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: base + "web", stdio: ["ignore", output, output],
    env: { ...process.env, NODE_ENV: "production", NEXT_DIST_DIR: ".next-e2e", DATABASE_URL: databaseUrl, AGG_CACHE: "off" },
  });
  let exited = false;
  child.on("exit", () => { exited = true; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error("Isolated server exited; see /tmp/e-f19-error-server.log");
    try { ready = (await fetch(origin + "/robots.txt")).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Isolated server did not become ready");
  // Transport-level filtering preserves streamed RSC bytes and denies every other origin.
  proxy = await originProxy(origin);
  browser = await chromium.launch();
  const failures = [];
  for (const [device, width, height] of [["desktop", 1280, 900], ["mobile", 412, 915]]) {
    const page = await browser.newPage({ viewport: { width, height }, proxy: proxy.options, serviceWorkers: "block" });
    for (const [name, path, heading] of [
      ["insights", "/insights", "Mönster i Stockholms innerstad"],
      ["compare", "/compare?series=street:sodermalm/gotgatan&g=year", "Götgatan (Södermalm)"],
      ["district", "/district/ostermalm?rooms=1&g=year", "Östermalm"],
      ["street", "/street/ostermalm/karlavagen?rooms=1&g=year", "Karlavägen"],
      ["house", "/street/ostermalm/karlavagen/2?g=year", "Karlavägen 2"],
    ]) {
      try {
        await prisma.$executeRawUnsafe('ALTER MATERIALIZED VIEW "DedupedListingMat" RENAME TO "AnalyticsProbeUnavailable"');
        renamed = true;
        await page.goto(origin + path);
        await expect(page.getByRole("heading", { name: /Kunde inte ladda/ })).toBeVisible();
        await expect(page.locator("body")).not.toContainText(/DedupedListingMat|PrismaClientKnownRequestError|AnalyticsProbeUnavailable/);
        await page.screenshot({ path: `${base}docs/screens/F19-${name}-error-${device}.png`, fullPage: true });
        await prisma.$executeRawUnsafe('ALTER MATERIALIZED VIEW "AnalyticsProbeUnavailable" RENAME TO "DedupedListingMat"');
        renamed = false;
        await page.getByRole("button", { name: "Försök igen", exact: true }).click();
        await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible({ timeout: 2500 });
        await expect(page.getByRole("heading", { name: /Kunde inte ladda/ })).toHaveCount(0);
        await expect(page).toHaveURL(origin + path);
        if (name !== "insights") {
          await expect(page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "År", exact: true })).toHaveAttribute("aria-current", "true");
        }
        if (name === "district" || name === "street") {
          await expect(page.getByRole("group", { name: "Antal rum" }).getByRole("link", { name: "1 rum", exact: true })).toHaveAttribute("aria-current", "true");
        }
        await page.waitForLoadState("networkidle");
        for (const chart of await page.locator(".recharts-wrapper").all()) {
          await chart.scrollIntoViewIfNeeded();
          await page.waitForTimeout(2000); // Capture completed visible chart animation.
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${base}docs/screens/F19-${name}-recovered-${device}.png`, fullPage: true });
        console.log(`PASS ${device} ${path}: actual healthy page restored with query state`);
      } catch (error) {
        failures.push(`${device} ${path}: ${error.message}`);
        console.error(`FAIL ${device} ${path}: healthy page did not recover`);
      } finally {
        if (renamed) {
          await prisma.$executeRawUnsafe('ALTER MATERIALIZED VIEW "AnalyticsProbeUnavailable" RENAME TO "DedupedListingMat"');
          renamed = false;
        }
      }
    }
    await page.close();
  }
  if (failures.length) throw new Error(failures.join("\n"));
} finally {
  if (renamed) await prisma.$executeRawUnsafe('ALTER MATERIALIZED VIEW "AnalyticsProbeUnavailable" RENAME TO "DedupedListingMat"');
  if (browser) await browser.close();
  if (proxy) await proxy.close();
  child?.kill("SIGTERM");
  if (output !== undefined) fs.closeSync(output);
  await prisma.$disconnect();
}
