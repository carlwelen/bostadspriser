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
  test(`short tablet summaries fit and every recent sale is reachable: capped=${truncated} (B25)`, async ({ page, consoleErrors }) => {
    await page.route("**/api/heatmap*", (route) => route.fulfill({ json: {
      type: "FeatureCollection", truncated, features: [1, 2, 3, 4, 5].map((n) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [18.07, 59.33] },
        properties: { pricePerSqm: 100_000, address: `Testgatan ${n}`, street: "Testgatan",
          houseNumber: String(n), district: "ostermalm", soldAt: "2025-06-02", sources: "hemnet" },
      })),
    } }));
    for (const width of [820, 768]) {
      await page.setViewportSize({ width, height: 400 });
      await page.goto("/");
      const heading = page.getByText("Senaste försäljningar", { exact: true });
      const recent = heading.locator("..");
      const label = page.getByText(truncated ? "5 försäljningar visas" : "5 försäljningar i urvalet", { exact: true });
      await expect(label).toBeVisible();
      const badge = label.locator("..");
      const [r, m, b] = await Promise.all([recent.boundingBox(), page.getByTestId("map-container").boundingBox(), badge.boundingBox()]);
      for (const box of [r!, b!]) {
        expect(box.x).toBeGreaterThanOrEqual(m!.x);
        expect(box.y).toBeGreaterThanOrEqual(m!.y);
        expect(box.x + box.width).toBeLessThanOrEqual(m!.x + m!.width);
        expect(box.y + box.height).toBeLessThanOrEqual(m!.y + m!.height);
      }
      expect(r!.y + r!.height).toBeLessThanOrEqual(b!.y);
      const withinCard = async (item: import("@playwright/test").Locator) => {
        await expect.poll(async () => {
          const box = (await item.boundingBox())!;
          return box.y >= r!.y - 0.5 && box.y + box.height <= r!.y + r!.height + 0.5;
        }).toBe(true);
        const box = (await item.boundingBox())!;
        // Chromium scrollTop is rounded while row geometry retains fractions.
        expect(box.y).toBeGreaterThanOrEqual(r!.y - 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(r!.y + r!.height + 0.5);
      };
      await withinCard(heading);
      const notice = page.getByRole("status").filter({ hasText: "Mapbox-token saknas" });
      if (await notice.isVisible()) {
        const warning = (await notice.boundingBox())!;
        expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(warning.y + warning.height);
      }
      await withinCard(recent.getByRole("listitem").first());
      expect(await recent.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await recent.hover();
      await page.mouse.wheel(0, 600);
      await expect.poll(() => recent.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await withinCard(recent.getByRole("listitem").last());
      await recent.focus();
      await page.keyboard.press("Home");
      await expect.poll(() => recent.evaluate((el) => el.scrollTop)).toBe(0);
      await withinCard(heading);
      await page.keyboard.press("End");
      await expect.poll(() => recent.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await withinCard(recent.getByRole("listitem").last());
      await expect(page.getByTestId("map-truncation")).toHaveCount(truncated ? 1 : 0);
    }
    expect(consoleErrors).toEqual([]);
  });

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
