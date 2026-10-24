import { expect, test } from "./fixtures";

test("short landscape phones keep a usable map and scrollable filters (F36)", async ({ page, consoleErrors }) => {
  for (const viewport of [{ width: 568, height: 320 }, { width: 667, height: 375 }, { width: 740, height: 360 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const map = page.getByTestId("map-container");
    const aside = page.getByRole("complementary");
    await expect(map).toBeVisible();
    const [m, a] = await Promise.all([map.boundingBox(), aside.boundingBox()]);
    expect(m!.height).toBeGreaterThanOrEqual(180);
    expect(m!.width).toBeGreaterThanOrEqual(280);
    expect(a!.height).toBeGreaterThanOrEqual(180);
    expect(a!.y + a!.height).toBeLessThanOrEqual(viewport.height);
    await aside.getByRole("button", { name: "Frekvens", exact: true }).click();
    await expect(aside.getByRole("button", { name: "Frekvens", exact: true })).toHaveAttribute("aria-pressed", "true");
    await aside.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(page.getByTestId("source-note")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(consoleErrors).toEqual([]);
});

test("search keeps results and close reachable as the visual viewport shrinks (F36)", async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.route("**/api/streets/all", (route) => route.fulfill({ json: Array.from({ length: 30 }, (_, i) => ({
    district: "ostermalm", street: `Testgatan ${i}`, slug: `testgatan-${i}`, count: 2,
    meanPricePerSqm: 100_000, medianPricePerSqm: 100_000,
  })) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sök gata" }).click();
  const dialog = page.getByRole("dialog", { name: "Sök gata" });
  const close = dialog.getByRole("button", { name: "Stäng sökningen" });
  const assertFits = async (top: number, height: number) => {
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(top);
    expect(box.y + box.height).toBeLessThanOrEqual(top + height);
    await dialog.getByRole("option").last().scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("option").last()).toBeInViewport();
    const last = (await dialog.getByRole("option").last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(top + height);
    const c = (await close.boundingBox())!;
    expect(c.y).toBeGreaterThanOrEqual(top);
    expect(c.y + c.height).toBeLessThanOrEqual(top + height);
  };
  await expect(dialog.getByRole("option")).toHaveCount(30);
  await assertFits(0, 320);
  // Desktop Chromium cannot open a phone keyboard. Model its visual viewport
  // resize/scroll events while checking the resulting real DOM geometry.
  await page.evaluate(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 180, width: 568, offsetTop: 50, offsetLeft: 0 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    window.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => (await dialog.boundingBox())!.y).toBeGreaterThanOrEqual(50);
  await assertFits(50, 180);
  await close.click();
  await expect(dialog).toBeHidden();
  expect(consoleErrors).toEqual([]);
});
