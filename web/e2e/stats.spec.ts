import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// F13 / F31: headline numbers come from the SQL summaries (median + mean over
// every sale, not the 50 most recent). Expected values are derived from the
// deterministic fixture in tests/fixtures/listings.ts:
//   Karlavägen: monthly 150 000..161 000 kr/m² + a deduplicated 160 000 sale
//   + a recent 170 000 sale -> 14 sales, median 156 500, mean 156 857.
//   Östermalm (3 streets, +5 000 per street): 38 sales, median 160 500, mean 160 737.
//   Karlavägen 2 (months 1, 5, 9 + the recent sale): 4 sales, median 156 000, mean 158 000.

function card(page: Page, label: string): Locator {
  // The summary cards are the first section of <main> (the house page also has an
  // h2 called "Försäljningar" further down).
  return page.locator("main > section").first().getByText(label, { exact: true }).locator("xpath=..");
}

async function expectCard(page: Page, label: string, value: RegExp | string) {
  await expect(card(page, label)).toContainText(value);
}

const DATE_SPAN = /2025-01-10\s*→\s*\d{4}-\d{2}-\d{2}/;

test("the street page summarises every sale with median and mean", async ({ page }) => {
  await page.goto("/street/ostermalm/karlavagen");
  await expectCard(page, "Försäljningar", /^\s*Försäljningar\s*14\b/i);
  await expectCard(page, "Median pris/m²", /156\s500\s*kr/);
  await expectCard(page, "Medelpris/m²", /156\s857\s*kr/);
  await expectCard(page, "Tidsspann", DATE_SPAN);
});

test("the address page summarises every sale at the address", async ({ page }) => {
  await page.goto("/street/ostermalm/karlavagen/2");
  await expectCard(page, "Försäljningar", /^\s*Försäljningar\s*4\b/i);
  await expectCard(page, "Median pris/m²", /156\s000\s*kr/);
  await expectCard(page, "Medelpris/m²", /158\s000\s*kr/);
  await expectCard(page, "Tidsspann", DATE_SPAN);
});

test("the district page shows median, mean, street count and span", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await expectCard(page, "Försäljningar", /^\s*Försäljningar\s*38\b/i);
  await expectCard(page, "Median pris/m²", /160\s500\s*kr/);
  await expectCard(page, "Medelpris/m²", /160\s737\s*kr/);
  await expectCard(page, "Antal gator", /^\s*Antal gator\s*3\b/i);
  await expectCard(page, "Tidsspann", DATE_SPAN);
});

// F31: the fixture's sales are all in 2025 plus one in the current month, so the
// two latest complete months are empty. The card says so instead of a bare dash.
test("the district MoM card explains when there is nothing to compare", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await expectCard(page, "Förändring mot föregående månad", "—");
  await expect(card(page, "Förändring mot föregående månad")).toContainText(
    "Inga försäljningar de två senaste hela månaderna."
  );
});

test("the street page labels the sales table with how many are shown", async ({ page }) => {
  await page.goto("/street/ostermalm/karlavagen");
  await expect(page.getByText("Visar 14 av 14 försäljningar.")).toBeVisible();
});
