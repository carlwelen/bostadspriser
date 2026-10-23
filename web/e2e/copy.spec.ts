import { expect, test } from "./fixtures";

// Swedish copy details on the analytics pages (fixture: tests/fixtures/listings.ts).

// F34: "1 sålda" is wrong; one sale is "1 såld".
test("the house list says '1 såld' for a single sale and 'sålda' for several", async ({ page }) => {
  // Götgatan 22 has exactly one (Booli-only) sale in the fixture; the other numbers have more.
  await page.goto("/street/sodermalm/gotgatan");
  const single = page.getByRole("link", { name: /Götgatan 22\b/ });
  await expect(single).toContainText("1 såld");
  await expect(single).not.toContainText("1 sålda");
  const several = page.getByRole("link", { name: /Götgatan 10\b/ });
  await expect(several).toContainText(/\d+ sålda/);
});
