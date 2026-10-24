import { expect, test } from "./fixtures";

// Secondary pages must fit the viewport width: no sideways page scroll at
// Pixel 7 width (412 px) or at the narrowest phones (320 px). Wide content
// (tables) scrolls inside its own container instead.

const SECONDARY_PAGES = [
  "/district/ostermalm",
  "/street/ostermalm/karlavagen",
  "/street/ostermalm/karlavagen/10",
  "/insights",
  "/compare",
  "/compare?series=district:ostermalm,district:vasastan",
];

for (const width of [412, 320]) {
  for (const path of SECONDARY_PAGES) {
    test(`${path} has no horizontal page overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
}

// F27: a wide table keeps its columns and scrolls inside its own container.
test("the recent-sales table scrolls inside its container on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/district/ostermalm");
  const table = page.getByRole("table").first();
  await table.scrollIntoViewIfNeeded();
  const scroller = table.locator("xpath=..");
  const { scrollWidth, clientWidth, overflowX } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(overflowX).toMatch(/auto|scroll/);
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  // The last column ("Källa") is reachable by scrolling the container.
  const lastHeader = page.getByRole("columnheader", { name: "Källa" });
  await lastHeader.scrollIntoViewIfNeeded();
  await expect(lastHeader).toBeInViewport({ ratio: 1 });
  expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

// F28: the server HTML must fit before Recharts measures the container.
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const path of SECONDARY_PAGES) {
    test(`${path} has no horizontal page overflow before hydration at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(path);
      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    });
  }
});
