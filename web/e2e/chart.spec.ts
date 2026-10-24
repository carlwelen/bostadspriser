import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// F11 / F12: the price chart has a true time axis (months without sales are
// gaps), tooltips show the number of sales, and buckets with fewer than 3
// sales are drawn muted. Fixture: Östermalm has 3 sales a month in 2025 (4 in
// 2025-06) and a single sale in the current month (2026-10 when written).

async function dotCenters(page: Page) {
  // The chart is below the fold on a 720px-high viewport, and mouse events outside
  // the viewport don't reach it.
  await page.locator(".recharts-wrapper").first().scrollIntoViewIfNeeded();
  const dots = page.locator("svg circle.recharts-dot");
  await expect(dots.first()).toBeVisible();
  const n = await dots.count();
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const b = await dots.nth(i).boundingBox();
    if (b) out.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  return out.sort((a, b) => a.x - b.x);
}

test("the x axis is a time axis: months without sales leave a gap", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await page.waitForLoadState("networkidle");
  const xs = (await dotCenters(page)).map((d) => d.x);
  expect(xs.length).toBe(13); // 12 months of 2025 + the current month
  const normalStep = xs[1] - xs[0];
  const lastStep = xs[xs.length - 1] - xs[xs.length - 2];
  // Dec 2025 -> the current month is many months apart, not one slot.
  expect(lastStep).toBeGreaterThan(normalStep * 5);
});

test("the line breaks across months without sales", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await page.waitForLoadState("networkidle");
  const d = await page.locator("svg path.recharts-area-curve").first().getAttribute("d");
  // Two sub-paths: Jan-Dec 2025, then the isolated last month.
  expect((d?.match(/M/g) ?? []).length).toBe(2);
});

test("buckets with fewer than 3 sales are muted", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await page.waitForLoadState("networkidle");
  await expect(page.locator('svg circle[data-low-sample="true"]')).toHaveCount(1);
  await expect(page.locator('svg circle[data-low-sample="false"]')).toHaveCount(12);
});

test("the tooltip shows the number of sales, and flags thin buckets", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await page.waitForLoadState("networkidle");
  const dots = await dotCenters(page);

  await page.mouse.move(dots[0].x, dots[0].y);
  const tooltip = page.locator(".recharts-tooltip-wrapper");
  await expect(tooltip).toContainText("3 försäljningar");
  await expect(tooltip).not.toContainText("få affärer");

  const last = dots[dots.length - 1];
  await page.mouse.move(last.x, last.y);
  await expect(tooltip).toContainText(/1 försäljning(?!ar)/);
  await expect(tooltip).not.toContainText("1 försäljningar");
  await expect(tooltip).toContainText("få affärer");
});

test("a multi-series tooltip lists every series with its sales count", async ({ page }) => {
  await page.goto("/compare?series=district:ostermalm,district:vasastan");
  await page.waitForLoadState("networkidle");
  const dots = await dotCenters(page);
  await page.mouse.move(dots[0].x, dots[0].y);
  const tooltip = page.locator(".recharts-tooltip-wrapper");
  await expect(tooltip).toContainText("Östermalm");
  await expect(tooltip).toContainText("Vasastan");
  await expect(tooltip).toContainText("3 försäljningar");
});

test("the legend sits inside the chart card", async ({ page }) => {
  await page.goto("/compare?series=district:ostermalm,district:vasastan");
  await page.waitForLoadState("networkidle");
  const card = page.getByRole("region", { name: "Prisjämförelse" });
  const legend = card.getByText("Vasastan", { exact: true });
  const cardBox = await card.boundingBox();
  const legendBox = await legend.boundingBox();
  expect(legendBox!.y + legendBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height);
});

for (const path of ["/street/ostermalm/karlavagen/2", "/street/sodermalm/gotgatan/22"]) {
  test(`low-sample address dots remain visible with 3:1 contrast: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const dots = page.locator('svg circle.recharts-dot[data-low-sample="true"][stroke="#2563eb"]');
    await expect(dots.first()).toBeVisible();
    const styles = await dots.evaluateAll((els) => els.map((el) => {
      const style = getComputedStyle(el);
      const rgb = style.stroke.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const alpha = Number(style.strokeOpacity) * Number(style.opacity);
      const linear = rgb.map((v) => {
        const s = (alpha * v + (1 - alpha) * 255) / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      return { contrast: 1.05 / (luminance + 0.05), alpha, radius: Number(el.getAttribute("r")), width: parseFloat(style.strokeWidth), fill: style.fill };
    }));
    for (const style of styles) {
      expect(style.contrast).toBeGreaterThanOrEqual(3);
      expect(style.alpha).toBe(1);
      expect(style.radius).toBeGreaterThanOrEqual(4);
      expect(style.width).toBeGreaterThanOrEqual(1.5);
      expect(style.fill).toBe("rgb(255, 255, 255)");
    }
  });
}


test("address markers remain painted above coincident street and district markers", async ({ page }) => {
  await page.goto("/street/ostermalm/karlavagen/2");
  await page.waitForLoadState("networkidle");
  await page.locator(".recharts-wrapper").first().scrollIntoViewIfNeeded();
  const dots = page.locator('svg circle.recharts-dot[data-low-sample="true"][stroke="#2563eb"]');
  await expect(dots).toHaveCount(4);
  // Hit testing follows actual SVG paint order. A later opaque circle can hide
  // an address marker even when its own stroke and CSS contrast are correct.
  await expect.poll(async () => dots.evaluateAll((els) => els.map((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top === el;
  }))).toEqual([true, true, true, true]);
});


for (const width of [320, 1280]) {
  test(`the full four-district tooltip is painted at ${width}px`, async ({ page, consoleErrors }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/compare?series=district:ostermalm,district:vasastan,district:norrmalm,district:sodermalm");
    await page.waitForLoadState("networkidle");
    await page.locator(".recharts-wrapper").scrollIntoViewIfNeeded();
    const dot = await page.locator("circle.recharts-dot").first().boundingBox();
    await page.mouse.move(dot!.x + dot!.width / 2, dot!.y + dot!.height / 2);
    const tooltip = page.locator(".recharts-tooltip-wrapper");
    await expect(tooltip).toContainText("Södermalm");
    // The last series count must actually be painted, including any part that
    // extends below the chart. DOM visibility alone misses ancestor clipping.
    const count = tooltip.locator("li").last().locator("p").last();
    await expect(count).toContainText("försäljningar");
    await expect.poll(() => count.evaluate((el) => {
      const box = el.getBoundingClientRect();
      // Tooltips ignore pointer events by default. Enable hit testing only for
      // this label; this does not change its layout or clipping.
      const previous = el.style.pointerEvents;
      el.style.pointerEvents = "auto";
      const painted = document.elementsFromPoint(box.x + box.width / 2, box.bottom - 1)
        .some((node) => node === el || el.contains(node));
      el.style.pointerEvents = previous;
      return painted;
    })).toBe(true);
    expect(consoleErrors).toEqual([]);
  });
}
