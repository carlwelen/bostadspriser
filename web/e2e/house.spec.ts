import { expect, test } from "./fixtures";

// F10: the address page compares the address with its street and its district.
test("the address chart has address, street and district series", async ({ page }) => {
  await page.goto("/street/ostermalm/karlavagen/10");
  await page.waitForLoadState("networkidle");
  const chart = page.locator("section", { has: page.getByRole("heading", { name: "Pris/m² över tid" }) });
  const legend = chart.getByRole("list", { name: "Diagramförklaring" });
  await expect(legend.getByText("Karlavägen 10", { exact: true })).toBeVisible();
  await expect(legend.getByText("Karlavägen (gata)", { exact: true })).toBeVisible();
  await expect(legend.getByText("Östermalm (stadsdel)", { exact: true })).toBeVisible();
  await expect(chart.getByText(/adress vs gata vs stadsdel/)).toBeVisible();
  // One line per series.
  await expect(chart.locator(".recharts-line")).toHaveCount(3);
});
