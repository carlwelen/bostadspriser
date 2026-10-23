import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The e2e build has no Mapbox token, so the map never initialises. These tests
// observe the DOM and the request log only.

const ERROR_BODY = { status: 500, contentType: "application/json", body: '{"error":"internal error"}' };

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

// F30: an error body must never be stored as if it were data.
test("an API error from /api/heatmap shows a message and does not crash the page", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.route("**/api/heatmap*", (route) => route.fulfill(ERROR_BODY));
  await page.goto("/");
  await expect(page.getByText("Kunde inte hämta data.")).toBeVisible();
  // The sidebar must still work.
  await expect(page.getByRole("button", { name: "Frekvens" })).toBeVisible();
  await page.getByRole("button", { name: "Frekvens" }).click();
  await expect(page.getByText("Kunde inte hämta data.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("an API error from /api/streets/all shows a message in the street search", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.route("**/api/streets/all*", (route) => route.fulfill(ERROR_BODY));
  await page.goto("/");
  await page.getByRole("button", { name: /Sök gata/ }).click();
  await expect(page.getByText("Kunde inte hämta data.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

// F2: with no district selected the API would treat the missing param as "all".
test("deselecting every district shows the empty state and requests nothing", async ({ page }) => {
  const heatmapRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/heatmap") heatmapRequests.push(r.url());
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(heatmapRequests.length).toBeGreaterThan(0);
  await expect(page.getByText("Inga stadsdelar valda")).toHaveCount(0);

  const names = ["Östermalm", "Vasastan", "Norrmalm", "Södermalm"];
  for (const name of names.slice(0, -1)) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await page.waitForLoadState("networkidle");
  expect(heatmapRequests.at(-1)).toContain("districts=sodermalm");

  heatmapRequests.length = 0;
  await page.getByRole("button", { name: "Södermalm", exact: true }).click();
  await expect(page.getByText("Inga stadsdelar valda")).toBeVisible();
  await expect(page.getByText("0 av 4")).toBeVisible();
  await expect(page.getByText("Laddar försäljningar…")).toHaveCount(0);
  await expect(page.getByText("Inga försäljningar i urvalet ännu")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(heatmapRequests).toEqual([]);

  // Frequency mode behaves the same.
  await page.getByRole("button", { name: "Frekvens" }).click();
  await expect(page.getByText("Inga stadsdelar valda")).toBeVisible();
  expect(heatmapRequests).toEqual([]);

  // Selecting a district again fetches and clears the empty state.
  await page.getByRole("button", { name: "Vasastan", exact: true }).click();
  await expect(page.getByText("Inga stadsdelar valda")).toHaveCount(0);
  await expect.poll(() => heatmapRequests.length).toBe(1);
  expect(heatmapRequests[0]).toContain("districts=vasastan");
});

// F15: filters round-trip through the URL.
function logHeatmapRequests(page: Page): URL[] {
  const urls: URL[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/heatmap") urls.push(u);
  });
  return urls;
}

test("filters are read from the URL on load", async ({ page }) => {
  const reqs = logHeatmapRequests(page);
  await page.goto("/?districts=vasastan&rooms=2,3&period=3mo&mode=frequency");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: "Vasastan", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Östermalm", "Norrmalm", "Södermalm"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.getByText("1 av 4")).toBeVisible();
  for (const [name, pressed] of [["1", "false"], ["2", "true"], ["3", "true"], ["4", "false"]]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", pressed);
  }
  await expect(page.getByRole("button", { name: "3 mån", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Frekvens", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("source-note")).toContainText("senaste 3 månaderna");

  expect(reqs).toHaveLength(1);
  expect(reqs[0].searchParams.get("districts")).toBe("vasastan");
  expect(reqs[0].searchParams.get("rooms")).toBe("2,3");
  expect(reqs[0].searchParams.get("sinceDays")).toBe("90");
});

test("changing a filter updates the URL without adding history entries", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const historyBefore = await page.evaluate(() => history.length);

  await page.getByRole("button", { name: "Södermalm", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "Allt", exact: true }).click();
  await page.getByRole("button", { name: "Frekvens", exact: true }).click();
  await page.getByRole("checkbox", { name: "Visa heatmap" }).uncheck();

  await expect.poll(() => new URL(page.url()).search).toBe(
    "?districts=ostermalm,vasastan,norrmalm&rooms=2&period=all&mode=frequency&heatmap=0"
  );
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);

  // Reload restores the same state.
  await page.reload();
  await expect(page.getByRole("button", { name: "Södermalm", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Allt", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox", { name: "Visa heatmap" })).not.toBeChecked();

  // Back to the defaults gives a clean URL.
  await page.getByRole("button", { name: "Södermalm", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "12 mån", exact: true }).click();
  await page.getByRole("button", { name: "Pris", exact: true }).click();
  await page.getByRole("checkbox", { name: "Visa heatmap" }).check();
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("invalid URL parameters fall back to the defaults", async ({ page }) => {
  const reqs = logHeatmapRequests(page);
  await page.goto("/?districts=gamla-stan&rooms=9,x&period=forever&mode=3d&heatmap=maybe");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("4 av 4")).toBeVisible();
  await expect(page.getByRole("button", { name: "12 mån", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Pris", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox", { name: "Visa heatmap" })).toBeChecked();
  expect(reqs).toHaveLength(1);
  expect(reqs[0].searchParams.get("districts")).toBe("ostermalm,vasastan,norrmalm,sodermalm");
  expect(reqs[0].searchParams.has("rooms")).toBe(false);
  expect(reqs[0].searchParams.get("sinceDays")).toBe("365");
});

test("/?districts= opens the empty state without a request", async ({ page }) => {
  const reqs = logHeatmapRequests(page);
  await page.goto("/?districts=");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Inga stadsdelar valda")).toBeVisible();
  await expect(page.getByText("0 av 4")).toBeVisible();
  expect(reqs).toHaveLength(0);
});

// F15 review: the landing page is server-rendered, so nav and sidebar exist
// before hydration and without JavaScript.
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the landing page still renders the nav and the filtered sidebar", async ({ page }) => {
    await page.goto("/?districts=vasastan");
    await expect(page.getByText("1 av 4")).toBeVisible();
    await expect(page.getByRole("link", { name: "Insikter" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Jämför" })).toBeVisible();
    for (const name of ["Östermalm", "Vasastan", "Norrmalm", "Södermalm"]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Vasastan", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

test("filter changes keep unrelated parameters and the hash; junk is cleaned up on load", async ({
  page,
}) => {
  await page.goto("/?utm_source=newsletter&mode=3d#karta");
  // `mode=3d` is invalid: the URL is canonicalised once, the rest stays.
  await expect.poll(() => new URL(page.url()).search).toBe("?utm_source=newsletter");
  expect(new URL(page.url()).hash).toBe("#karta");

  await page.getByRole("button", { name: "Vasastan", exact: true }).click();
  await page.getByRole("button", { name: "Frekvens", exact: true }).click();
  await expect.poll(() => new URL(page.url()).search).toBe(
    "?utm_source=newsletter&districts=ostermalm,norrmalm,sodermalm&mode=frequency"
  );
  expect(new URL(page.url()).hash).toBe("#karta");
});

// F20: the landing page works at phone width.
// 320 CSS px is the WCAG 1.4.10 reflow width; the default viewport is the project's own.
for (const width of [null, 320] as const) {
  test.describe(width ? "at 320 px" : "at the default viewport", () => {
    if (width) test.use({ viewport: { width, height: 568 } });
    const label = width ? " (320 px)" : "";
  test(`nothing on the landing page overflows the viewport horizontally${label}`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("map-container")).toBeVisible();
    const overflowing = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad: string[] = [];
      for (const el of document.querySelectorAll("nav *, aside *, main")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Descendants of the scrolling sidebar are clipped by it; only horizontal bounds matter.
        if (r.left < -0.5 || r.right > vw + 0.5) {
          bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
        }
      }
      return bad;
    });
    expect(overflowing).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test(`every top nav target is reachable on the landing page${label}`, async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation");
    const targets = [
      nav.getByRole("link", { name: "Insikter" }),
      nav.getByRole("link", { name: "Jämför" }),
      nav.getByRole("button", { name: /Sök gata/ }),
      nav.getByRole("link", { name: /Bostadspriser/ }),
    ];
    const vw = page.viewportSize()!.width;
    for (const t of targets) {
      await expect(t).toBeVisible();
      const box = (await t.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw);
      // Big enough to tap.
      expect(box.height).toBeGreaterThanOrEqual(28);
    }
    await nav.getByRole("link", { name: "Insikter" }).click();
    await expect(page).toHaveURL(/\/insights$/);
  });

  });
}

test("the sidebar hints at more filters below and the source note is reachable", async ({ page }) => {
  await page.goto("/");
  const aside = page.getByRole("complementary");
  const scrolls = await aside.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(scrolls).toBe(true); // true at both the desktop and the Pixel 7 viewport
  await expect(page.getByTestId("sidebar-more")).toBeVisible();
  await aside.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.getByTestId("source-note")).toBeInViewport();
  await expect(page.getByTestId("sidebar-more")).toBeHidden();
});

// F21: small text keeps WCAG AA contrast against its white background.
test("the filter counter and the legend captions meet AA contrast", async ({ page }) => {
  await page.goto("/");
  for (const text of ["4 av 4", "Pris/m² (kr)", "Skalan anpassas efter urvalet."]) {
    const el = page.getByText(text, { exact: true });
    if ((await el.count()) === 0) continue; // the caption only shows for adapted scales
    const ratio = await el.first().evaluate((node) => {
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.fillStyle = getComputedStyle(node).color;
      ctx.fillRect(0, 0, 1, 1);
      return 1.05 / (lum(Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))) + 0.05);
    });
    expect(ratio, text).toBeGreaterThanOrEqual(4.5);
  }
});

// F34: the count pill agrees with its number.
test("the map status pill uses the singular for exactly one sale", async ({ page }) => {
  await page.route("**/api/heatmap*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [18.07, 59.33] },
            properties: { pricePerSqm: 100_000, address: "Testgatan 1", street: "Testgatan", houseNumber: "1", district: "ostermalm", soldAt: "2025-06-02", source: "hemnet", sources: "hemnet", dedupKey: null },
          },
        ],
      }),
    })
  );
  await page.goto("/");
  await expect(page.getByText("1 försäljning i urvalet", { exact: true })).toBeVisible();
});

// F17: the price legend follows the points on screen.
test("the price legend is computed from the displayed points", async ({ page }) => {
  const features = Array.from({ length: 50 }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [18.07, 59.33] },
    properties: {
      pricePerSqm: 50_000 + i * 1000,
      address: `Testgatan ${i + 1}`,
      street: "Testgatan",
      houseNumber: String(i + 1),
      district: "ostermalm",
      soldAt: "2025-06-02",
      source: "hemnet",
      sources: "hemnet",
      dedupKey: null,
    },
  }));
  await page.route("**/api/heatmap*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ type: "FeatureCollection", features }),
    })
  );
  await page.goto("/");
  const legend = page.getByTestId("price-legend");
  await expect(legend.locator("span")).toHaveText(["≤52k", "62k", "75k", "87k", "97k+"]);
  await expect(legend.getByText("Skalan anpassas efter urvalet.")).toBeVisible();
});

test("the price legend shows the default scale when there is no data", async ({ page }) => {
  await page.goto("/?districts=");
  await expect(page.getByTestId("price-legend").locator("span")).toHaveText([
    "≤80k",
    "120k",
    "150k",
    "180k",
    "220k+",
  ]);
  // The default scale is not adapted to anything, so no such claim.
  await expect(page.getByText("Skalan anpassas efter urvalet.")).toHaveCount(0);
});

// F7: the sidebar note names both sources and follows the selected period.
test("the sidebar source note names Hemnet and Booli and follows the period", async ({ page }) => {
  await page.goto("/");
  const note = page.getByTestId("source-note");
  await expect(note).toContainText("Hemnet");
  await expect(note).toContainText("Booli");
  await expect(note).toContainText("senaste 12 månaderna");
  await page.getByRole("button", { name: "30 dagar", exact: true }).click();
  await expect(note).toContainText("senaste 30 dagarna");
  await page.getByRole("button", { name: "3 mån", exact: true }).click();
  await expect(note).toContainText("senaste 3 månaderna");
  await page.getByRole("button", { name: "Allt", exact: true }).click();
  await expect(note).toContainText("hela perioden");
  await expect(note).not.toContainText("12 mån");

  // WCAG AA (4.5:1) against the white sidebar.
  const ratio = await note.evaluate((el) => {
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // Tailwind 4 colours are oklch(); rasterise one pixel to get sRGB.
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el).color;
    ctx.fillRect(0, 0, 1, 1);
    const fg = Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    return 1.05 / (lum(fg) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

// F6: the e2e build always has an empty NEXT_PUBLIC_MAPBOX_TOKEN.
test("a missing Mapbox token shows a clear message and keeps the sidebar working", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "NEXT_PUBLIC_MAPBOX_TOKEN" })).toHaveText(
    "Kartan kunde inte laddas: Mapbox-token saknas (NEXT_PUBLIC_MAPBOX_TOKEN)."
  );
  // The sidebar is unaffected.
  await page.getByRole("button", { name: "Vasastan", exact: true }).click();
  await expect(page.getByText("3 av 4")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

// The long variable name is one unbreakable word; at Pixel 7 width the notice
// used to overflow its container and clip on both sides.
test("the missing-token notice stays inside the map area", async ({ page }) => {
  await page.goto("/");
  // The map must keep a usable width next to the sidebar (it stacks on phones).
  const mapBox = await page.getByTestId("map-container").boundingBox();
  expect(mapBox!.width).toBeGreaterThanOrEqual(300);
  const notice = page.getByText("Kartan kunde inte laddas");
  await expect(notice).toBeVisible();
  const [box, container] = await Promise.all([
    notice.boundingBox(),
    page.getByTestId("map-container").boundingBox(),
  ]);
  expect(box!.x).toBeGreaterThanOrEqual(container!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(container!.x + container!.width + 0.5);
  // No horizontal overflow inside the notice itself.
  expect(await notice.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
