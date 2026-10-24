// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeatmapMap } from "../HeatmapMap";
import type { HeatmapResponse } from "@/lib/api-types";
import type { DistrictSlug } from "@/lib/districts";

vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function response(truncated: boolean): HeatmapResponse {
  return { type: "FeatureCollection", truncated, features: [1, 2].map((n) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [18.07, 59.33] },
    properties: { pricePerSqm: 100_000, address: `Testgatan ${n}`, street: "Testgatan",
      houseNumber: String(n), district: "ostermalm", soldAt: "2025-06-02", sources: "hemnet" },
  })) };
}

function mount() {
  const requests: { resolve: (body: HeatmapResponse) => void; reject: (error: Error) => void }[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve, reject) => {
    requests.push({ resolve: (body) => resolve({ ok: true, status: 200, json: async () => body }), reject });
  })));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (districts: DistrictSlug[]) => act(async () => {
    root.render(createElement(HeatmapMap, { districts, showHeatmap: true, mode: "price" }));
  });
  const resolve = (i: number, truncated: boolean) => act(async () => requests[i].resolve(response(truncated)));
  const hint = () => host.querySelector('[data-testid="map-truncation"]');
  return { host, requests, render, resolve, hint };
}

describe("heatmap truncation notice (B25)", () => {
  it("explains that the shown count covers only newest matching sales", async () => {
    const m = mount();
    await m.render(["ostermalm"]);
    await m.resolve(0, true);
    expect(m.hint()?.textContent).toContain("senaste matchande försäljningarna");
    expect(m.host.textContent).toContain("2 försäljningar visas");
    expect(m.host.textContent).not.toContain("2 försäljningar i urvalet");
  });

  it("clears the notice during loading, on an uncapped response, and on errors", async () => {
    const m = mount();
    await m.render(["ostermalm"]);
    await m.resolve(0, true);
    expect(m.hint()).not.toBeNull();
    await m.render(["vasastan"]);
    expect(m.hint()).toBeNull();
    expect(m.host.textContent).toContain("Laddar försäljningar");
    await m.resolve(1, false);
    expect(m.hint()).toBeNull();
    expect(m.host.textContent).toContain("2 försäljningar i urvalet");
    await m.render(["norrmalm"]);
    await m.resolve(2, true);
    expect(m.hint()).not.toBeNull();
    await m.render(["sodermalm"]);
    await act(async () => m.requests[3].reject(new Error("offline")));
    expect(m.hint()).toBeNull();
    expect(m.host.textContent).toContain("Kunde inte hämta data.");
  });

  it("clears the notice for an empty selection and ignores its pending response", async () => {
    const m = mount();
    await m.render(["ostermalm"]);
    await m.resolve(0, true);
    expect(m.hint()).not.toBeNull();
    await m.render(["vasastan"]);
    await m.render([]);
    expect(m.hint()).toBeNull();
    expect(m.requests).toHaveLength(2);
    await m.resolve(1, true);
    expect(m.hint()).toBeNull();
    expect(m.host.textContent).toContain("Inga stadsdelar valda");
    expect(m.host.textContent).not.toContain("försäljningar visas");
  });

  for (const newest of [true, false]) {
    it(`a stale ${!newest ? "capped" : "uncapped"} response cannot replace the current metadata`, async () => {
      const m = mount();
      await m.render(["ostermalm"]);
      await m.render(["vasastan"]);
      await m.resolve(1, newest);
      expect(Boolean(m.hint())).toBe(newest);
      await m.resolve(0, !newest);
      expect(Boolean(m.hint())).toBe(newest);
    });
  }
});
