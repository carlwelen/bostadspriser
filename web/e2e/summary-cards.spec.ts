import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

const PAGES = [
  { route: "/district/ostermalm", title: "Östermalm" },
  { route: "/street/ostermalm/karlavagen", title: "Karlavägen" },
  { route: "/street/ostermalm/karlavagen/2", title: "Karlavägen 2" },
];

async function expectCompleteCards(summary: Locator) {
  await expect(summary.getByText("Försäljningar", { exact: true })).toBeVisible();
  await expect(summary.getByText("Median pris/m²", { exact: true })).toBeVisible();
  await expect(summary.getByText("Medelpris/m²", { exact: true })).toBeVisible();
  await expect(summary.getByText("Tidsspann", { exact: true })).toBeVisible();
  const clipped = await summary.locator("p").evaluateAll((nodes) => nodes.flatMap((node) => {
    const bounds = node.getBoundingClientRect();
    const card = node.parentElement!.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const outside = [...range.getClientRects()].some((rect) =>
      rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < card.top - 1 || rect.bottom > card.bottom + 1);
    return node.scrollWidth > node.clientWidth + 1 || outside ? [node.textContent] : [];
  }));
  expect(clipped).toEqual([]);
}

for (const width of [320, 640, 1280]) {
  for (const { route, title } of PAGES) {
    test(`summary labels and values fit ${route} at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
      const summary = page.locator("main > section").filter({ has: page.getByText("Median pris/m²", { exact: true }) });
      await expectCompleteCards(summary);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
      if (width === 320 && info.project.name === "desktop") {
        await page.screenshot({ path: info.outputPath(`F44-${route.replace(/\//g, "-").slice(1)}-320.png`), fullPage: true });
      }
    });
  }
}

test("summary values wrap an unbroken street name without losing text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/street/ostermalm/karlavagen/2");
  await page.waitForLoadState("networkidle");
  const summary = page.locator("main > section").filter({ has: page.getByText("Median pris/m²", { exact: true }) });
  const street = summary.locator("div").filter({ has: page.getByText("Gata", { exact: true }) }).locator("p").nth(1);
  const longName = "Liljeholmsstrandspromenaden";
  await street.evaluate((node, text) => { node.textContent = text; }, longName);
  await expect(street).toHaveText(longName);
  await expectCompleteCards(summary);
});

