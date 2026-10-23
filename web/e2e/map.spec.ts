import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The e2e build has no Mapbox token, so the map never initialises. These tests
// observe the DOM and the request log only.

const ERROR_BODY = { status: 500, contentType: "application/json", body: '{"error":"internal error"}' };

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

// F30: an error body must never be stored as if it were data.
test("an API error from /api/heatmap shows a message and does not crash the page", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.route("**/api/heatmap*", (route) => route.fulfill(ERROR_BODY));
  await page.goto("/");
  await expect(page.getByText("Kunde inte hämta data.")).toBeVisible();
  // The sidebar must still work.
  await expect(page.getByRole("button", { name: "Frekvens" })).toBeVisible();
  await page.getByRole("button", { name: "Frekvens" }).click();
  await expect(page.getByText("Kunde inte hämta data.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("an API error from /api/streets/all shows a message in the street search", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.route("**/api/streets/all*", (route) => route.fulfill(ERROR_BODY));
  await page.goto("/");
  await page.getByRole("button", { name: /Sök gata/ }).click();
  await expect(page.getByText("Kunde inte hämta data.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
