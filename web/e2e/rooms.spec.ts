import { expect, test } from "./fixtures";

for (const path of ["/district/ostermalm", "/street/ostermalm/karlavagen"]) {
  test(`${path} filters rooms and preserves URL state across granularity`, async ({ page }) => {
    await page.goto(path);
    const rooms = page.getByRole("group", { name: "Antal rum" });
    await rooms.getByRole("link", { name: "1 rum", exact: true }).click();
    await expect(page).toHaveURL(/rooms=1/);
    await expect(rooms.getByRole("link", { name: "1 rum", exact: true })).toHaveAttribute("aria-current", "true");
    const cards = page.locator("main > section").filter({ hasText: "Mittenvärdet" }).locator("div").first();
    await expect(cards.locator("p").nth(1)).toHaveText(path.startsWith("/district") ? "6" : "2");
    await page.getByRole("link", { name: "År", exact: true }).click();
    await expect(page).toHaveURL(/rooms=1.*g=year|g=year.*rooms=1/);
    await rooms.getByRole("link", { name: "5+ rum", exact: true }).click();
    await expect(page).toHaveURL(/rooms=1%2C5/);
    await expect(page).toHaveURL(/g=year/);
    const rows = page.locator("table tbody tr");
    for (const row of await rows.all()) {
      await expect(row.locator("td").nth(2)).toHaveText(/^(1|5|6)$/);
    }
    await rooms.getByRole("link", { name: "Alla rum", exact: true }).click();
    await expect(page).not.toHaveURL(/rooms=/);
    await expect(page).toHaveURL(/g=year/);
  });
}
