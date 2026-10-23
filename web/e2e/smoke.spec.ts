import { expect, test } from "./fixtures";

// Paths resolve against the deterministic fixture in tests/fixtures/listings.ts.
const PAGES = [
  { path: "/", heading: null },
  { path: "/district/ostermalm", heading: /Östermalm/ },
  { path: "/street/ostermalm/karlavagen", heading: /Karlavägen/ },
  { path: "/street/ostermalm/karlavagen/10", heading: /Karlavägen 10/ },
  { path: "/compare", heading: null },
  { path: "/insights", heading: null },
] as const;

for (const { path, heading } of PAGES) {
  test(`${path} renders without console errors`, async ({ page, consoleErrors }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    if (heading) await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    expect(consoleErrors).toEqual([]);
  });
}

for (const { path } of PAGES) {
  test(`${path} declares the Swedish document language`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  });
}

test("the landing page renders the map container", async ({ page, consoleErrors }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-container")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("unknown districts render the not-found page", async ({ page }) => {
  await page.goto("/district/gamla-stan");
  await expect(page.getByText("404", { exact: true })).toBeVisible();
});

// F26: a loading.tsx Suspense boundary above notFound() commits a 200 before the
// page can reject the URL, so unknown params are validated in layouts above it.
const UNKNOWN_PATHS = [
  "/district/gamla-stan",
  "/street/gamla-stan/karlavagen",
  "/street/ostermalm/no-such-street",
  "/street/ostermalm/karlavagen/9999",
  "/street/ostermalm/no-such-street/10",
  "/street/gamla-stan/karlavagen/10",
];
for (const path of UNKNOWN_PATHS) {
  test(`${path} responds with HTTP 404 and the not-found UI`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByText("404", { exact: true })).toBeVisible();
  });
}

test("the landing page stays full-bleed and does not scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-container")).toBeVisible();
  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement!.scrollHeight,
    clientHeight: document.scrollingElement!.clientHeight,
  }));
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  // Wheel input must not move the page either.
  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, 2000);
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
});

const TALL_PAGES = [
  "/district/ostermalm",
  "/street/ostermalm/karlavagen",
  "/insights",
  "/compare?series=district:ostermalm,district:vasastan",
];
for (const path of TALL_PAGES) {
  test(`${path} scrolls to the footer with the mouse wheel`, async ({ page, isMobile }) => {
    // Real input on purpose: programmatic scrollTop works even when
    // `overflow-hidden` blocks the user (F1).
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    if (isMobile) {
      // Touch-emulated devices: drive a scroll through the CDP gesture API.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.synthesizeScrollGesture", { x: 200, y: 400, yDistance: -4000, speed: 4000 });
    } else {
      await page.mouse.move(400, 400);
      await page.mouse.wheel(0, 10_000);
    }
    // Not ratio 1: the document height is fractional, so the last <1px of the
    // footer can sit below the maximum (integer) scroll offset.
    await expect(page.locator("footer").last()).toBeInViewport({ ratio: 0.95 });
    expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBeGreaterThan(0);
  });
}
