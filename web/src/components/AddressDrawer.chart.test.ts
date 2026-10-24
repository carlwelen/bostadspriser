// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AddressDrawer, type AddressSelection } from "./AddressDrawer";
import type { AddressResponse } from "@/lib/api-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("plots every address sale when two prices share a date (F40)", async () => {
  const selection: AddressSelection = {
    district: "ostermalm", street: "Karlavägen", houseNumber: "10", address: "Karlavägen 10",
    pricePerSqm: 130_000, soldAt: "2025-06-20", sources: ["hemnet"],
  };
  const data: AddressResponse = {
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
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 360, 256));
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
    expect(host.querySelectorAll(".recharts-scatter-symbol path")).toHaveLength(3);
    const coordinates = [...host.querySelectorAll(".recharts-scatter-symbol path")]
      .map((point) => [Number(point.getAttribute("cx")), Number(point.getAttribute("cy"))]);
    expect(new Set(coordinates.map((point) => point[1])).size).toBe(3);
    expect(new Set(coordinates.map((point) => point[0])).size).toBe(2);
  } finally {
    await act(async () => root.unmount());
  }
});
