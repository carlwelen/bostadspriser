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

// F2: with no district selected the API would treat the missing param as "all".
test("deselecting every district shows the empty state and requests nothing", async ({ page }) => {
  const heatmapRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/heatmap") heatmapRequests.push(r.url());
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(heatmapRequests.length).toBeGreaterThan(0);
  await expect(page.getByText("Inga stadsdelar valda")).toHaveCount(0);

  const names = ["Östermalm", "Vasastan", "Norrmalm", "Södermalm"];
  for (const name of names.slice(0, -1)) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await page.waitForLoadState("networkidle");
  expect(heatmapRequests.at(-1)).toContain("districts=sodermalm");

  heatmapRequests.length = 0;
  await page.getByRole("button", { name: "Södermalm", exact: true }).click();
  await expect(page.getByText("Inga stadsdelar valda")).toBeVisible();
  await expect(page.getByText("0 av 4")).toBeVisible();
  await expect(page.getByText("Laddar försäljningar…")).toHaveCount(0);
  await expect(page.getByText("Inga försäljningar i urvalet ännu")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(heatmapRequests).toEqual([]);

  // Frequency mode behaves the same.
  await page.getByRole("button", { name: "Frekvens" }).click();
  await expect(page.getByText("Inga stadsdelar valda")).toBeVisible();
  expect(heatmapRequests).toEqual([]);

  // Selecting a district again fetches and clears the empty state.
  await page.getByRole("button", { name: "Vasastan", exact: true }).click();
  await expect(page.getByText("Inga stadsdelar valda")).toHaveCount(0);
  await expect.poll(() => heatmapRequests.length).toBe(1);
  expect(heatmapRequests[0]).toContain("districts=vasastan");
});

// F6: the e2e build always has an empty NEXT_PUBLIC_MAPBOX_TOKEN.
test("a missing Mapbox token shows a clear message and keeps the sidebar working", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "NEXT_PUBLIC_MAPBOX_TOKEN" })).toHaveText(
    "Kartan kunde inte laddas: Mapbox-token saknas (NEXT_PUBLIC_MAPBOX_TOKEN)."
  );
  // The sidebar is unaffected.
  await page.getByRole("button", { name: "Vasastan", exact: true }).click();
  await expect(page.getByText("3 av 4")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
