import { expect, test } from "./fixtures";

test("a district keeps its colour alone, in reordered comparisons, in an address overlay and in insights", async ({ page }) => {
  await page.goto("/compare?series=district:vasastan");
  const curve = page.locator(".recharts-area-curve");
  await expect(curve).toBeVisible();
  const color = await curve.evaluate((element) => getComputedStyle(element).stroke);
  for (const series of ["district:ostermalm,district:vasastan", "district:vasastan,district:ostermalm"]) {
    await page.goto(`/compare?series=${series}`);
    const swatch = page.getByRole("listitem").filter({ hasText: "Vasastan" }).locator("span");
    await expect(swatch).toHaveCSS("background-color", color);
  }
  await page.goto("/district/vasastan");
  await expect(page.locator(".recharts-area-curve")).toHaveCSS("stroke", color);
  await page.goto("/street/vasastan/odengatan/2");
  await expect(page.getByRole("listitem").filter({ hasText: "Vasastan (stadsdel)" }).locator("span")).toHaveCSS("background-color", color);
  await page.goto("/insights");
  const legend = page.getByRole("group", { name: "Yta och pris per kvadratmeter per stadsdel" }).locator("div.flex.flex-wrap");
  await expect(legend.getByText("Vasastan", { exact: true }).locator("span")).toHaveCSS("background-color", color);
});
