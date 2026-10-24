// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import type { AddressResponse } from "@/lib/api-types";
import { DrawerTooltip } from "./DrawerTooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("lets keyboard users scroll dense same-day records without changing the active chart date (F12)", async () => {
  const data: AddressResponse = {
    district: "ostermalm", street: "Karlavägen", house: "10", period: "12mo", granularity: "month",
    streetSeries: [],
    addressSales: Array.from({ length: 20 }, (_, i) => ({
      soldAt: "2026-06-01", priceSek: 3_000_000, pricePerSqmSek: 100_000 + i * 1000, sources: ["hemnet"],
    })),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const bubbled: string[] = [];
  try {
    await act(async () => root.render(createElement("div", {
      onKeyDown: (event) => bubbled.push(event.key),
    }, createElement(DrawerTooltip, { active: true, label: Date.parse("2026-06-01"), data }))));
    const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    tooltip.focus();
    expect(document.activeElement).toBe(tooltip);
    expect(tooltip.textContent).toContain("119 000 kr/m²");
    for (const key of ["Home", "End", "ArrowDown", "PageDown", "Tab", "Escape"]) {
      tooltip.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    expect(bubbled).toEqual(["Tab", "Escape"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
