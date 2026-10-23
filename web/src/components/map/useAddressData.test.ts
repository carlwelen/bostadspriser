// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAddressData } from "./useAddressData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const query = { district: "ostermalm", street: "Karlavägen", houseNumber: "10" };

afterEach(() => vi.unstubAllGlobals());

function Probe() {
  const { data, loading, error } = useAddressData(query, "12mo");
  // Mirrors what AddressDrawer does with `data`: this throws on an error body.
  const sales = data
    ? data.streetSeries.reduce((n, p) => n + p.count, 0) + data.addressSales.length
    : null;
  return createElement("p", null, JSON.stringify({ sales, loading, error }));
}

async function run(res: { ok: boolean; status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: res.ok, status: res.status, json: async () => res.body }))
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Probe));
  });
  const state = JSON.parse(host.textContent ?? "{}");
  await act(async () => root.unmount());
  return state;
}

describe("useAddressData (F30)", () => {
  it("flags an error and keeps data null on a 500 JSON error body", async () => {
    expect(await run({ ok: false, status: 500, body: { error: "internal error" } })).toEqual({
      sales: null,
      loading: false,
      error: true,
    });
  });

  it("flags an error on a 400 with issues", async () => {
    const s = await run({ ok: false, status: 400, body: { error: "bad", issues: [] } });
    expect(s).toMatchObject({ sales: null, error: true });
  });

  it("returns data for an ok response", async () => {
    const body = { streetSeries: [{ bucket: "b", meanPricePerSqm: 1, count: 2 }], addressSales: [{}] };
    expect(await run({ ok: true, status: 200, body })).toEqual({ sales: 3, loading: false, error: false });
  });
});
