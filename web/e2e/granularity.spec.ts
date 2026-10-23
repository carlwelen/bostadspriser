import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// F8: Månad/År toggle on every time-series chart, state in the URL (?g=year).
// The fixture spans 2025-01 .. 2026-10 (one sale in the current month).

const CHART_PAGES = [
  "/district/ostermalm",
  "/street/ostermalm/karlavagen",
  "/street/ostermalm/karlavagen/10",
  "/compare?series=district:ostermalm,district:vasastan",
];

// Axis labels are <text> nodes in the chart's SVG (Recharts doesn't keep them
// under a stable per-axis class); the y axis reads "153k", so a month/year
// pattern picks the x axis.
const MONTH_LABEL = /^[a-zåäö]{3} \d{2}$/; // "jan 25"
const YEAR_LABEL = /^\d{4}$/; // "2025"
function xTicks(page: Page, pattern: RegExp) {
  return page.locator("svg text").filter({ hasText: pattern });
}

for (const path of CHART_PAGES) {
  test(`${path} has a Månad/År toggle that switches the chart to yearly buckets`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const group = page.getByRole("group", { name: "Tidsupplösning" });
    await expect(group.getByRole("link", { name: "Månad" })).toHaveAttribute("aria-current", "true");
    await expect(group.getByRole("link", { name: "År" })).not.toHaveAttribute("aria-current", "true");
    await expect(xTicks(page, MONTH_LABEL).first()).toBeVisible();
    expect(await xTicks(page, YEAR_LABEL).count()).toBe(0);

    await group.getByRole("link", { name: "År" }).click();
    await expect(page).toHaveURL(/[?&]g=year\b/);
    await expect(page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "År" })).toHaveAttribute(
      "aria-current",
      "true"
    );
    await page.waitForLoadState("networkidle");
    await expect(xTicks(page, YEAR_LABEL).first()).toBeVisible();
    expect(await xTicks(page, MONTH_LABEL).count()).toBe(0); // "2025", never "jan 25"
    expect((await xTicks(page, YEAR_LABEL).allTextContents()).sort()).toEqual(["2025", "2026"]);

    // Back to months: the parameter disappears again.
    await page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "Månad" }).click();
    await expect(page).not.toHaveURL(/[?&]g=/);
  });
}

test("?g=year is read from the URL on load, and survives the compare presets", async ({ page }) => {
  await page.goto("/compare?series=district:ostermalm&g=year");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "År" })
  ).toHaveAttribute("aria-current", "true");
  await page.getByRole("link", { name: "Vasastan", exact: true }).first().click();
  await expect(page).toHaveURL(/series=district(%3A|:)ostermalm(%2C|,)district(%3A|:)vasastan/);
  await expect(page).toHaveURL(/[?&]g=year\b/);
});

test("an unknown g value falls back to months", async ({ page }) => {
  await page.goto("/district/ostermalm?g=banana");
  await expect(
    page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "Månad" })
  ).toHaveAttribute("aria-current", "true");
});

test("the yearly subtitle says year means", async ({ page }) => {
  await page.goto("/district/ostermalm?g=year");
  await expect(page.getByText("Årsmedel")).toBeVisible();
});
