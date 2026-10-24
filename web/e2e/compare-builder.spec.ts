import { expect, test } from "./fixtures";

test("builds a comparison with streets and districts by keyboard and can remove every series", async ({ page }) => {
  test.setTimeout(15000);
  await page.goto("/compare?series=district:ostermalm&g=year");
  const search = page.getByRole("combobox", { name: "Lägg till gata eller stadsdel" });
  await search.fill("gotgatan");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/street%3Asodermalm%2Fgotgatan/);
  await expect(page).toHaveURL(/g=year/);
  const selected = page.getByRole("group", { name: "Valda serier" });
  await expect(selected.getByRole("link", { name: "Ta bort Götgatan (Södermalm)" })).toBeVisible();
  await search.fill("Vasastan");
  await page.getByRole("option", { name: "Vasastan", exact: true }).click();
  await expect(selected.getByRole("link")).toHaveCount(3);
  await selected.getByRole("link", { name: "Ta bort Östermalm", exact: true }).click();
  await selected.getByRole("link", { name: "Ta bort Götgatan (Södermalm)", exact: true }).click();
  await selected.getByRole("link", { name: "Ta bort Vasastan", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inga serier valda");
  await expect(page).toHaveURL(/series=&g=year/);
  await expect(selected.getByRole("link")).toHaveCount(0);
});

test("deduplicates repeated and comma-separated series and rejects malformed street paths", async ({ page, consoleErrors }) => {
  await page.goto("/compare?series=district:ostermalm,district:ostermalm&series=street:sodermalm/gotgatan&series=street:sodermalm/gotgatan/extra");
  const selected = page.getByRole("group", { name: "Valda serier" });
  await expect(selected.getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Östermalm vs Götgatan (Södermalm)");
  expect(consoleErrors).toEqual([]);
});

test("street chart offers a comparison link", async ({ page }) => {
  await page.goto("/street/sodermalm/gotgatan");
  await page.getByRole("link", { name: "Jämför →", exact: true }).click();
  await expect(page).toHaveURL(/series=street/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Götgatan (Södermalm)");
});
