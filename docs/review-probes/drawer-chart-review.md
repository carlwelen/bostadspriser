# Drawer chart browser probe (F11/F12/F40)

The permanent real-SVG tests run in `AddressDrawer.chart.test.ts`. To independently exercise hover geometry and take screenshots, temporarily place the following page at `web/src/app/drawer-review-fixture/page.tsx` and spec at `web/screens/f12-drawer.spec.ts`. Use a dedicated test database and port, run `pnpm e2e:build`, then `pnpm screens f12-drawer.spec.ts` from `web`. Remove both temporary files before the full gate or any production build. No live map token or external network is needed; the API is fulfilled locally by the hermetic fixtures.

Page:

```tsx
"use client";
import { AddressDrawer } from "@/components/AddressDrawer";
export default function DrawerReview() {
  return <AddressDrawer selection={{ district: "ostermalm", street: "Karlavägen", houseNumber: "10", address: "Karlavägen 10", pricePerSqm: 130_000, soldAt: "2026-06-20", sources: ["hemnet"] }} onClose={() => {}} />;
}
```

Spec:

```tsx
import path from "node:path";
import { test, expect } from "../e2e/fixtures";
test("capture elapsed time and missing street bucket in the drawer", async ({ page }, info) => {
  await page.route("**/api/address*", (route) => route.fulfill({ json: {
    district: "ostermalm", street: "Karlavägen", house: "10", period: "12mo", granularity: "month",
    streetSeries: [
      { bucket: "2026-05-01", meanPricePerSqm: 140_000, medianPricePerSqm: 145_000, count: 1 },
      { bucket: "2026-06-01", meanPricePerSqm: 150_000, medianPricePerSqm: 155_000, count: 4 },
      { bucket: "2026-08-01", meanPricePerSqm: 140_000, medianPricePerSqm: 145_000, count: 1 },
      { bucket: "2026-09-01", meanPricePerSqm: 150_000, medianPricePerSqm: 155_000, count: 4 },
    ],
    addressSales: [
      { soldAt: "2026-06-20", priceSek: 3_900_000, pricePerSqmSek: 130_000, sources: ["hemnet"] },
      { soldAt: "2026-06-02", priceSek: 3_600_000, pricePerSqmSek: 120_000, sources: ["booli"] },
      { soldAt: "2026-06-03", priceSek: 3_000_000, pricePerSqmSek: 100_000, sources: ["hemnet"] },
    ],
  } }));
  await page.goto("/drawer-review-fixture");
  await expect(page.locator(".recharts-scatter-symbol path")).toHaveCount(3);
  await page.waitForTimeout(1700);
  const coordinates = await page.locator(".recharts-scatter-symbol path").evaluateAll((points) => points.map((point) => [Number(point.getAttribute("cx")), Number(point.getAttribute("cy"))]));
  expect(new Set(coordinates.map((point) => point[0])).size).toBe(3);
  expect(new Set(coordinates.map((point) => point[1])).size).toBe(3);
  const xs = coordinates.map((point) => point[0]).sort((a, b) => a - b);
  expect((xs[1] - xs[0]) / (xs[2] - xs[0])).toBeCloseTo(1 / 18, 5);
  expect((await page.locator(".recharts-area-curve").getAttribute("d"))?.match(/M/g)).toHaveLength(2);
  const streetDots = page.locator(".recharts-area-dots circle");
  await expect(streetDots).toHaveCount(4);
  await expect(streetDots.first()).toHaveAttribute("fill", "white");
  await expect(streetDots.first()).toHaveAttribute("r", "4");
  await expect(streetDots.nth(1)).toHaveAttribute("fill", "#1d4ed8");
  await streetDots.first().hover({ force: true });
  await expect(page.getByRole("tooltip")).toContainText("1 försäljning · få affärer");
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.screenshot({ path: path.resolve(__dirname, `../../docs/screens/F12-thin-${info.project.name}.png`), fullPage: true });
  await streetDots.nth(1).hover({ force: true });
  await expect(page.getByRole("tooltip")).toContainText("4 försäljningar");
  await expect(page.getByRole("tooltip")).not.toContainText("få affärer");
  await page.locator(".recharts-scatter-symbol path").first().hover({ force: true });
  await expect(page.locator(".recharts-tooltip-wrapper")).toContainText("1 försäljning");
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.screenshot({ path: path.resolve(__dirname, `../../docs/screens/F12-drawer-${info.project.name}.png`), fullPage: true });
});
```

## Dense same-day tooltip correction

Copy `docs/review-probes/drawer-dense.spec.ts` to `web/screens/f12-dense-review.spec.ts` with the same temporary page above. Run with the isolated database and port as above. This checks 8, 20 and the API maximum of 200 same-day observations, viewport/drawer containment, wheel and keyboard access to the last record, and actual mobile touch scrolling. Ordinary date-by-date hover is also retained. Remove the temporary page/spec before the full gate.

Before the correction, the 20-record geometry probe failed on both desktop and mobile (`/tmp/d-f12-dense-red.log`). The permanent keyboard regression failed because the tooltip could not receive focus (`/tmp/d-f12-dense-keyboard-red.log`). The corrected tooltip stays at the chart top, constrains its height, allows scrolling of dense records, and keeps scroll keys from changing the active chart date. Small tooltips remain transparent to pointer hit testing. Browser results and visual captures are in `/tmp/d-f12-dense-final-probe.log` and `docs/screens/F12-dense-*.png`.
