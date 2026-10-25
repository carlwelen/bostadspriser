import type { Page } from "@playwright/test";
import { test, expect } from "../e2e/fixtures";

// Copy to web/screens and use the temporary drawer-review-fixture page described
// in drawer-keyboard-review.md. No production fixture route is retained.
const data = {
  district: "ostermalm", street: "Karlavägen", house: "10", period: "12mo", granularity: "month",
  streetSeries: [{ bucket: "2026-06-01", meanPricePerSqm: 150_000, medianPricePerSqm: 155_000, count: 37 }],
  addressSales: Array.from({ length: 20 }, (_, index) => ({
    soldAt: "2026-06-01", priceSek: 3_000_000, pricePerSqmSek: 100_000 + index * 1_000, sources: ["hemnet"],
  })),
};

test.afterEach(async ({ consoleErrors }) => expect(consoleErrors).toEqual([]));

async function openWithKeyboard(page: Page) {
  await page.route("**/api/address*", (route) => route.fulfill({ json: data }));
  await page.goto("/drawer-review-fixture");
  await expect(page.getByRole("dialog")).toBeFocused();
  // Reopen through its real trigger so Escape must restore that trigger's focus.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Öppna", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeFocused();
  await expect(page.locator(".recharts-scatter-symbol path")).toHaveCount(20);
  await page.waitForTimeout(1700);
}

async function tabToChart(page: Page) {
  const chart = page.getByRole("application");
  for (let n = 0; n < 8 && !(await chart.evaluate((element) => element === document.activeElement)); n++) {
    await page.keyboard.press("Tab");
  }
  await expect(chart).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tooltip")).toBeVisible();
  return chart;
}

test("keyboard-only tooltip entry, scrolling, and both tab exit directions (F12)", async ({ page }, info) => {
  await openWithKeyboard(page);
  const chart = await tabToChart(page);
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("37 försäljningar");
  await page.keyboard.press("Shift+Tab");
  await expect(tooltip).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => tooltip.evaluate((element) => Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight))).toBeLessThan(2);
  const lastSale = await tooltip.locator("div").last().boundingBox();
  const bounds = (await tooltip.boundingBox())!;
  expect(lastSale!.y + lastSale!.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  await page.screenshot({ path: `../docs/screens/F12-keyboard-${info.project.name}.png`, fullPage: true });
  await page.keyboard.press("Home");
  await expect.poll(() => tooltip.evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press("Tab");
  await expect(chart).toBeFocused();
  await expect(tooltip).toHaveCount(0);
  // Re-enter after returning to the chart, then leave backward to the period controls.
  await page.keyboard.press("ArrowRight");
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(tooltip).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("tab", { name: "Allt", exact: true })).toBeFocused();
  await expect(tooltip).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(chart).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Öppna full sida" })).toBeFocused();
  await expect(tooltip).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Öppna", exact: true })).toBeFocused();
});

test("Escape inside a keyboard tooltip returns focus to the drawer trigger (F12)", async ({ page }) => {
  await openWithKeyboard(page);
  await tabToChart(page);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("tooltip")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Öppna", exact: true })).toBeFocused();
});

test("hover does not steal focus from drawer controls (F12)", async ({ page }) => {
  await openWithKeyboard(page);
  await page.keyboard.press("Tab");
  const close = page.getByRole("button", { name: "Stäng", exact: true });
  await expect(close).toBeFocused();
  await page.locator(".recharts-scatter-symbol path").last().hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(close).toBeFocused();
});
