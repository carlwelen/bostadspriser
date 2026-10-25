import { expect, test } from "./fixtures";

for (const method of ["keyboard", "link"] as const) {
  test(`same-route street search ${method} selection closes mobile menu; cancel preserves it`, async ({ page, consoleErrors }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/street/ostermalm/karlavagen");
    await page.waitForLoadState("networkidle");
    const toggle = page.getByRole("button", { name: "Meny" });
    await toggle.click();
    const menu = page.getByRole("navigation", { name: "Huvudmeny" });
    const trigger = menu.getByRole("button", { name: "Sök gata" });
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toBeFocused();
    await trigger.click();
    const input = page.getByRole("combobox");
    await input.fill("Karlavägen");
    await expect(page.getByRole("option").first()).toBeVisible();
    if (method === "keyboard") await input.press("Enter");
    else await page.getByRole("option").first().getByRole("link").click();
    await expect(page.getByRole("dialog", { name: "Sök gata" })).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    expect(consoleErrors).toEqual([]);
  });
}

test("chart data can be opened by keyboard and tables have names and column scopes", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("application", { name: "Prisutveckling: Östermalm", exact: true })).toBeVisible();
  const summary = page.locator("summary", { hasText: "Prisutveckling – diagramdata" });
  await summary.focus();
  await page.keyboard.press("Enter");
  const table = page.getByRole("table", { name: "Prisutveckling – diagramdata", exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Antal försäljningar" })).toHaveAttribute("scope", "col");
  await expect(page.getByRole("table", { name: "Senaste försäljningar" })).toBeVisible();
  if (page.viewportSize()!.width < 768) {
    await page.getByRole("button", { name: "Meny" }).click();
    await expect(page.getByRole("navigation", { name: "Huvudmeny" }).getByText("Östermalm", { exact: true })).toHaveAttribute("aria-current", "page");
  } else {
    await expect(page.getByRole("navigation", { name: "Brödsmulor" }).getByText("Östermalm")).toHaveAttribute("aria-current", "page");
  }
});
