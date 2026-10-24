// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AddressDrawer, type AddressSelection } from "./AddressDrawer";
import { drawerSeries } from "./map/drawerSeries";
import type { AddressResponse } from "@/lib/api-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const selection: AddressSelection = {
    district: "ostermalm", street: "Karlavägen", houseNumber: "10", address: "Karlavägen 10",
    pricePerSqm: 130_000, soldAt: "2025-06-20", sources: ["hemnet"],
  };
const fixture: AddressResponse = {
    district: "ostermalm", street: "Karlavägen", house: "10", period: "12mo", granularity: "month",
    streetSeries: [
      { bucket: "2025-06-01", meanPricePerSqm: 140_000, medianPricePerSqm: 145_000, count: 3 },
      { bucket: "2025-07-01", meanPricePerSqm: 150_000, medianPricePerSqm: 155_000, count: 4 },
    ],
    addressSales: [
      { soldAt: "2025-06-20", priceSek: 3_900_000, pricePerSqmSek: 130_000, sources: ["hemnet"] },
      { soldAt: "2025-06-02", priceSek: 3_600_000, pricePerSqmSek: 120_000, sources: ["booli"] },
      { soldAt: "2025-06-02", priceSek: 3_000_000, pricePerSqmSek: 100_000, sources: ["hemnet"] },
    ],
  };

async function renderChart(data: AddressResponse, check: (host: HTMLDivElement) => void | Promise<void>) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.id === "recharts_measurement_span"
      ? new DOMRect(0, 0, (this.textContent?.length ?? 0) * 6, 12)
      : new DOMRect(0, 0, 360, 256);
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: new DOMRect(0, 0, 360, 256) } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AddressDrawer, { selection, onClose: () => {} })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1700)); });
    await check(host);
  } finally {
    await act(async () => root.unmount());
  }
}

function coordinates(host: HTMLElement) {
  return [...host.querySelectorAll(".recharts-scatter-symbol path")]
    .map((point) => [Number(point.getAttribute("cx")), Number(point.getAttribute("cy"))]);
}

it("plots every address sale when two prices share a date (F40)", async () => {
  await renderChart(fixture, (host) => {
    const points = coordinates(host);
    expect(points).toHaveLength(3);
    expect(new Set(points.map((point) => point[1])).size).toBe(3);
    expect(new Set(points.map((point) => point[0])).size).toBe(2);
  });
});

it("spaces address observations by elapsed time (F11)", async () => {
  await renderChart({ ...fixture, streetSeries: [], addressSales: [
    { ...fixture.addressSales[0], soldAt: "2025-06-02" },
    { ...fixture.addressSales[1], soldAt: "2025-06-03" },
    { ...fixture.addressSales[2], soldAt: "2025-06-20" },
  ] }, (host) => {
    const xs = coordinates(host).map((point) => point[0]).sort((a, b) => a - b);
    expect((xs[1] - xs[0]) / (xs[2] - xs[0])).toBeCloseTo(1 / 18, 5);
  });
});

it.each([
  { granularity: "month" as const, buckets: ["2025-12-01", "2026-01-01", "2026-03-01", "2026-04-01"] },
  { granularity: "week" as const, buckets: ["2025-03-17", "2025-03-24", "2025-04-07", "2025-04-14"] },
  { granularity: "day" as const, buckets: ["2025-03-28", "2025-03-29", "2025-03-31", "2025-04-01"] },
])("breaks the street curve at missing $granularity buckets without breaking at address observations (F11)", async ({ granularity, buckets }) => {
  await renderChart({ ...fixture, granularity, streetSeries: buckets.map((bucket, index) => ({
    ...fixture.streetSeries[index % 2], bucket,
  })) }, (host) => {
    const curve = host.querySelector(".recharts-area-curve")?.getAttribute("d") ?? "";
    expect(curve.match(/M/g)).toHaveLength(2);
    if (granularity === "month") {
      expect(host.textContent).toContain("apr 26");
    }
    expect(curve.match(/L|C/g)?.length).toBeGreaterThanOrEqual(2);
    expect(coordinates(host)).toHaveLength(3);
  });
});

it("keeps sparse street buckets visible as hollow points (F12)", async () => {
  await renderChart({ ...fixture, streetSeries: [
    { ...fixture.streetSeries[0], count: 1 },
    { ...fixture.streetSeries[1], count: 4 },
  ] }, (host) => {
    const dots = [...host.querySelectorAll(".recharts-area-dots circle")];
    expect(dots).toHaveLength(2);
    expect(dots[0].getAttribute("fill")).toBe("white");
    expect(Number(dots[0].getAttribute("r"))).toBeGreaterThanOrEqual(4);
    expect(dots[1].getAttribute("fill")).toBe("#1d4ed8");
  });
});

it("shows a visible tooltip for an address date with no street bucket (F12)", async () => {
  await renderChart({ ...fixture, streetSeries: ["2025-05-01", "2025-06-01", "2025-08-01", "2025-09-01"]
    .map((bucket, index) => ({ ...fixture.streetSeries[index % 2], bucket })) }, async (host) => {
    const [x, y] = coordinates(host)[0];
    await act(async () => {
      host.querySelector(".recharts-wrapper")!.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, clientX: x, clientY: y,
      }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("1 försäljning");
    const wrapper = host.querySelector<HTMLElement>(".recharts-tooltip-wrapper");
    expect(wrapper?.style.visibility).toBe("visible");
  });
});

it("uses the uncapped SQL street median and count for its headline (B14)", async () => {
  await renderChart({ ...fixture, streetSummary: {
    count: 700, medianPricePerSqm: 117_000, meanPricePerSqm: 200_000,
    earliest: "2025-01-01", latest: "2025-07-01",
  } }, (host) => {
    const card = [...host.querySelectorAll("p")].find((p) => p.textContent === "Median på gatan")?.parentElement;
    expect(card?.textContent).toContain("117 000 kr/m²");
    expect(card?.textContent).toContain("700 försäljningar");
    expect(card?.textContent).toContain("200 000 kr/m²");
    expect(host.textContent).toContain("Visade affärer");
    expect(host.textContent).not.toContain("bucket");
  });
});

it("does not manufacture a street summary when SQL data is unavailable (B14)", async () => {
  await renderChart(fixture, (host) => {
    const card = [...host.querySelectorAll("p")].find((p) => p.textContent === "Median på gatan")?.parentElement;
    expect(card?.textContent).toContain("—");
    expect(card?.textContent).not.toContain("kr/m²");
  });
});

it("plots each SQL bucket median without re-aggregating rows (B14)", () => {
  expect(drawerSeries(fixture).trendRows.map((point) => point.trend)).toEqual([145_000, 155_000]);
});

it("names the focusable drawer chart for assistive technology (F21)", async () => {
  await renderChart(fixture, (host) => {
    const chart = host.querySelector('svg[role="application"]');
    expect(chart?.getAttribute("aria-label")).toBe("Prisutveckling på Karlavägen 10 och gatan");
    expect(chart?.getAttribute("tabindex")).toBe("0");
  });
});
