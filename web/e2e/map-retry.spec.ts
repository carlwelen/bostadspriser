import { test, expect } from "./fixtures";

test("map retry reloads the same selection and keeps keyboard focus (F19)", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/heatmap*", async (route) => {
    requests.push(route.request().url());
    if (requests.length === 1) {
      await route.fulfill({ status: 500, json: { error: "temporary" } });
    } else {
      await route.continue();
    }
  });
  await page.goto("/?districts=ostermalm&rooms=2&period=all");
  const retry = page.getByRole("button", { name: "Försök igen", exact: true });
  await expect(retry).toBeVisible();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Kunde inte hämta data." })).toHaveCount(0);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toBe(requests[0]);
  await expect(page.getByTestId("map-container")).toBeFocused();
  await expect(page.getByText("Laddar försäljningar…")).toHaveCount(0);
});

test("street search retry keeps the query and restores input focus (F19)", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/streets/all*", async (route) => {
    if (++requests === 1) {
      await route.fulfill({ status: 500, json: { error: "temporary" } });
    } else {
      await route.continue();
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Sök gata/ }).click();
  const input = page.getByRole("combobox", { name: "Sök gata eller stadsdel" });
  await input.fill("Karlavägen");
  const retry = page.getByRole("button", { name: "Försök igen", exact: true });
  await expect(retry).toBeVisible();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option").filter({ hasText: "Karlavägen" })).toBeVisible();
  await expect(input).toHaveValue("Karlavägen");
  await expect(input).toBeFocused();
  expect(requests).toBe(2);
  await expect(page.getByRole("alert").filter({ hasText: "Kunde inte hämta data." })).toHaveCount(0);
});
