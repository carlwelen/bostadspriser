import { expect, test } from "./fixtures";

for (const ids of [
  ["street:ostermalm/karlavagen", "district:ostermalm", "district:vasastan", "district:norrmalm", "street:vasastan/odengatan"],
  ["street:ostermalm/karlavagen", "district:ostermalm", "street:vasastan/odengatan", "district:vasastan", "street:norrmalm/drottninggatan", "district:norrmalm", "street:sodermalm/gotgatan", "district:sodermalm"],
  ["street:ostermalm/karlavagen", "street:vasastan/odengatan", "street:norrmalm/drottninggatan", "street:sodermalm/gotgatan", "street:ostermalm/strandvagen"],
  ["street:ostermalm/karlavagen", "street:vasastan/odengatan", "street:norrmalm/drottninggatan", "street:sodermalm/gotgatan", "street:ostermalm/strandvagen", "street:vasastan/surbrunnsgatan", "street:norrmalm/kungsgatan", "street:sodermalm/hornsgatan"],
]) {
  const streets = ids.filter((id) => id.startsWith("street:")).length;
  test(`comparisons use every available tone before repeating (${streets} streets, ${ids.length - streets} districts)`, async ({ page, consoleErrors }) => {
    await page.goto(`/compare?series=${ids.join(",")}`);
    const legend = page.getByRole("list", { name: "Diagramförklaring" }).getByRole("listitem");
    await expect(legend).toHaveCount(ids.length);
    const colors = await legend.locator("span").evaluateAll((swatches) => swatches.map((swatch) => getComputedStyle(swatch).backgroundColor));
    expect(new Set(colors).size).toBe(ids.length);
    const selected = page.getByRole("group", { name: "Valda serier" }).getByRole("link");
    await expect(selected).toHaveCount(ids.length);
    for (let i = 0; i < ids.length; i++) {
      await expect(selected.nth(i).locator("span").first()).toHaveCSS("background-color", colors[i]);
    }
    await expect(page.locator(".recharts-line-curve")).toHaveCount(ids.length);
    const strokes = await page.locator(".recharts-line-curve").evaluateAll((curves) => curves.map((curve) => getComputedStyle(curve).stroke));
    expect(strokes.sort()).toEqual([...colors].sort());
    expect(consoleErrors).toEqual([]);
  });
}

test("scatter observations retain graphical-object contrast after compositing on white", async ({ page, consoleErrors }) => {
  await page.goto("/insights");
  const scatter = page.getByRole("group", { name: "Yta och pris per kvadratmeter per stadsdel" });
  const points = scatter.locator(".recharts-scatter-symbol path");
  await expect(points.first()).toBeVisible();
  const rendered = await points.evaluateAll((elements) => {
    const contrastOnWhite = (color: string, alpha: number) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const linear = rgb.map((channel) => {
        const composite = (alpha * channel + (1 - alpha) * 255) / 255;
        return composite <= 0.04045 ? composite / 12.92 : ((composite + 0.055) / 1.055) ** 2.4;
      });
      return 1.05 / (linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 + 0.05);
    };
    return elements.map((element) => {
      const style = getComputedStyle(element);
      const fill = contrastOnWhite(style.fill, Number(style.fillOpacity) * Number(style.opacity));
      const outline = Number.parseFloat(style.strokeWidth) >= 1
        ? contrastOnWhite(style.stroke, Number(style.strokeOpacity) * Number(style.opacity)) : 1;
      return { fill: style.fill, stroke: style.stroke, contrast: Math.max(fill, outline) };
    });
  });
  expect(new Set(rendered.map((point) => point.fill)).size).toBe(4);
  for (const point of rendered) expect(point.contrast, JSON.stringify(point)).toBeGreaterThanOrEqual(3);
  expect(consoleErrors).toEqual([]);
});

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
