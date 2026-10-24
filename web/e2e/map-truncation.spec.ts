import { expect, test } from "./fixtures";

test("the map distinguishes displayed capped sales from the full selection (B25)", async ({ page, consoleErrors }) => {
  let truncated = true;
  await page.route("**/api/heatmap*", (route) => route.fulfill({ json: {
    type: "FeatureCollection", truncated, features: [1, 2].map((n) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [18.07, 59.33] },
      properties: { pricePerSqm: 100_000, address: `Testgatan ${n}`, street: "Testgatan",
        houseNumber: String(n), district: "ostermalm", soldAt: "2025-06-02", sources: "hemnet" },
    })),
  } }));
  await page.goto("/");
  const hint = page.getByTestId("map-truncation");
  await expect(hint).toContainText("senaste matchande försäljningarna");
  await expect(page.getByText("2 försäljningar visas", { exact: true })).toBeVisible();
  await expect(page.getByText("2 försäljningar i urvalet", { exact: true })).toHaveCount(0);
  await expect(hint).toBeInViewport();
  const box = (await hint.boundingBox())!;
  const map = (await page.getByTestId("map-container").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(map.x);
  expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width);
  truncated = false;
  await page.getByRole("button", { name: "Vasastan", exact: true }).click();
  await expect(hint).toHaveCount(0);
  await expect(page.getByText("2 försäljningar i urvalet", { exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

for (const truncated of [true, false]) {
  test(`map summaries do not overlap at tablet widths: capped=${truncated} (B25)`, async ({ page, consoleErrors }) => {
    await page.route("**/api/heatmap*", (route) => route.fulfill({ json: {
      type: "FeatureCollection", truncated, features: [1, 2, 3, 4, 5].map((n) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [18.07, 59.33] },
        properties: { pricePerSqm: 100_000, address: `Testgatan ${n}`, street: "Testgatan",
          houseNumber: String(n), district: "ostermalm", soldAt: "2025-06-02", sources: "hemnet" },
      })),
    } }));
    await page.goto("/");
    const label = page.getByText(truncated ? "5 försäljningar visas" : "5 försäljningar i urvalet", { exact: true });
    for (const width of [768, 820, 900, 1024]) {
      await page.setViewportSize({ width, height: 700 });
      await expect(label).toBeVisible();
      const badge = label.locator("..");
      const recent = page.getByText("Senaste försäljningar", { exact: true }).locator("..");
      await expect(recent).toBeVisible();
      const [b, r, m] = await Promise.all([badge.boundingBox(), recent.boundingBox(), page.getByTestId("map-container").boundingBox()]);
      const overlaps = b!.x < r!.x + r!.width && b!.x + b!.width > r!.x
        && b!.y < r!.y + r!.height && b!.y + b!.height > r!.y;
      expect(overlaps, `summaries overlap at ${width}px`).toBe(false);
      for (const box of [b!, r!]) {
        expect(box.x).toBeGreaterThanOrEqual(m!.x);
        expect(box.y).toBeGreaterThanOrEqual(m!.y);
        expect(box.x + box.width).toBeLessThanOrEqual(m!.x + m!.width);
        expect(box.y + box.height).toBeLessThanOrEqual(m!.y + m!.height);
      }
      expect(m!.y + m!.height - b!.y - b!.height).toBeCloseTo(12, 0);
    }
    expect(consoleErrors).toEqual([]);
  });
}
