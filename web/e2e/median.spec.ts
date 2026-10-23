import { expect, test } from "./fixtures";

// B14 (UI): lists, charts and tables lead with the median kr/m² and keep the
// mean as secondary information. Fixture numbers (tests/fixtures/listings.ts):
//   Karlavägen: 14 sales, median 156 500, mean 156 857.
//   Karlavägen 2: 4 sales, median 156 000, mean 158 000.

test("the district's street list leads with the median", async ({ page }) => {
  await page.goto("/district/ostermalm");
  const row = page.getByRole("link", { name: /^Karlavägen/ });
  await expect(row).toContainText(/156\s500/);
  await expect(row).toContainText("median");
  await expect(row).toContainText(/medel\s+156\s857/);
});

test("the house cards lead with the median", async ({ page }) => {
  await page.goto("/street/ostermalm/karlavagen");
  const card = page.getByRole("link", { name: /^Karlavägen 2\b/ });
  await expect(card).toContainText(/Median\s+156\s000/);
  await expect(card).toContainText(/medel\s+158\s000/);
});

test("the chart tooltip shows the median first and the mean beside it", async ({ page }) => {
  await page.goto("/street/ostermalm/karlavagen/2");
  await page.waitForLoadState("networkidle");
  await page.locator(".recharts-wrapper").first().scrollIntoViewIfNeeded();
  const dots = page.locator("svg circle.recharts-dot");
  await expect(dots.first()).toBeVisible();
  const b = (await dots.first().boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const tooltip = page.locator(".recharts-tooltip-wrapper");
  await expect(tooltip).toContainText("Median");
  await expect(tooltip).toContainText("Medel");
});

test("the chart captions say median", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await expect(page.getByText("Median kr/m² per månad")).toBeVisible();
  await page.goto("/compare");
  await expect(page.getByText(/Median kr\/m² per månad/)).toBeVisible();
});

test("insights lead with the median and tabulate both", async ({ page }) => {
  await page.goto("/insights");
  const cards = page.locator("main > section").first();
  await expect(cards.getByText("Median pris/m²", { exact: true })).toBeVisible();
  await expect(cards.getByText("Medelpris/m²", { exact: true })).toBeVisible();
  const header = page.getByRole("columnheader");
  await expect(header.filter({ hasText: "Median pris/m²" })).toHaveCount(1);
  await expect(header.filter({ hasText: "Medel pris/m²" })).toHaveCount(1);
});
