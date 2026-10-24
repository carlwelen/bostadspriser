import { expect, test } from "./fixtures";

// F18: "Senast uppdaterad" and per-source coverage on /insights. e2e/global-setup.ts
// seeds these ScrapeRun rows (times are UTC; Stockholm is UTC+1 before 29 March 2026):
//   hemnet: ostermalm ok 2026-03-18 07:10, vasastan ok 2026-03-20 08:00 -> 20 mars 09:00
//   booli:  ostermalm partial 2026-03-22 07:30, vasastan ok 2026-03-21 07:00 -> 22 mars 08:30
// Raw listing rows in the fixture: hemnet 149, booli 2 (FIXTURE_COUNTS.raw = 151).

test("insights say when the data was last updated", async ({ page }) => {
  await page.goto("/insights");
  const hero = page.locator("section").first();
  await expect(hero).toContainText(/Senast uppdaterad 22 mars 2026\s+kl\.\s+08:30/);
});

test("insights list every source with its last update and coverage", async ({ page }) => {
  await page.goto("/insights");
  const sources = page.locator("section", { has: page.getByRole("heading", { name: "Datakällor" }) });
  const hemnet = sources.getByRole("row", { name: /Hemnet/ });
  await expect(hemnet).toContainText(/20 mars 2026\s+kl\.\s+09:00/);
  await expect(hemnet.getByRole("cell").last()).toHaveText("149");
  await expect(hemnet).toContainText(/2025-01-10\s*→\s*\d{4}-\d{2}-\d{2}/);
  const booli = sources.getByRole("row", { name: /Booli/ });
  await expect(booli).toContainText(/22 mars 2026\s+kl\.\s+08:30/);
  await expect(booli.getByRole("cell").last()).toHaveText("2");
});

test("a source whose latest run stopped early is flagged", async ({ page }) => {
  await page.goto("/insights");
  const sources = page.locator("section", { has: page.getByRole("heading", { name: "Datakällor" }) });
  await expect(sources).toContainText(/Booli \(Östermalm\): senaste hämtningen avbröts/);
  await expect(sources.getByRole("row", { name: /Hemnet/ })).not.toContainText("avbröts");
});
