// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAddressData, type AddressQuery, type Period } from "./useAddressData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddressData>;
type Res = { ok: boolean; status: number; body: unknown };

const A: AddressQuery = { district: "ostermalm", street: "Karlavägen", houseNumber: "10" };
const B: AddressQuery = { district: "vasastan", street: "Odengatan", houseNumber: "2" };

afterEach(() => vi.unstubAllGlobals());

function body(tag: string) {
  return {
    street: tag,
    streetSeries: [{ bucket: "b", meanPricePerSqm: 1, count: 2 }],
    addressSales: [{}],
  };
}

/** Mounts the hook; `fetchFor` decides each response, and may return a pending promise. */
function mount(fetchFor: (url: string) => Promise<Res> | Res) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const r = await fetchFor(url);
      return { ok: r.ok, status: r.status, json: async () => r.body };
    })
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const latest: { hook: Hook | null; renders: Hook[] } = { hook: null, renders: [] };
  function Probe({ query, period }: { query: AddressQuery | null; period: Period }) {
    const h = useAddressData(query, period);
    latest.hook = h;
    latest.renders.push(h);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (query: AddressQuery | null, period: Period = "12mo") =>
    act(async () => {
      root.render(createElement(Probe, { query, period }));
    });
  return { latest, render, unmount: () => act(async () => root.unmount()) };
}

const ok = (b: unknown): Res => ({ ok: true, status: 200, body: b });

describe("useAddressData (F30)", () => {
  it("flags an error and keeps data null on a 500 JSON error body", async () => {
    const m = mount(() => ({ ok: false, status: 500, body: { error: "internal error" } }));
    await m.render(A);
    expect(m.latest.hook).toMatchObject({ data: null, loading: false, error: true });
    await m.unmount();
  });

  it("flags an error on a 400 with issues", async () => {
    const m = mount(() => ({ ok: false, status: 400, body: { error: "bad", issues: [] } }));
    await m.render(A);
    expect(m.latest.hook).toMatchObject({ data: null, error: true });
    await m.unmount();
  });

  it("returns data for an ok response", async () => {
    const m = mount(() => ok(body("A")));
    await m.render(A);
    expect(m.latest.hook).toMatchObject({ loading: false, error: false });
    expect(m.latest.hook!.data?.street).toBe("A");
    await m.unmount();
  });
});

describe("useAddressData (F33)", () => {
  it("never shows A's data for B, not even in the render right after the switch", async () => {
    let resolveB!: (r: Res) => void;
    const m = mount((url) =>
      url.includes("street=Odengatan")
        ? new Promise<Res>((r) => (resolveB = r))
        : ok(body("A"))
    );
    await m.render(A);
    expect(m.latest.hook!.data?.street).toBe("A");

    m.latest.renders.length = 0;
    await m.render(B);
    // Every render since the switch, including the very first one, must hide A's data.
    expect(m.latest.renders.length).toBeGreaterThan(0);
    for (const h of m.latest.renders) {
      expect(h.data).toBeNull();
      expect(h.loading).toBe(true);
    }

    await act(async () => resolveB(ok(body("B"))));
    expect(m.latest.hook).toMatchObject({ loading: false, error: false });
    expect(m.latest.hook!.data?.street).toBe("B");
    await m.unmount();
  });

  it("treats a period change as loading too", async () => {
    let resolve!: (r: Res) => void;
    const m = mount((url) =>
      url.includes("period=3mo") ? new Promise<Res>((r) => (resolve = r)) : ok(body("12mo"))
    );
    await m.render(A, "12mo");
    await m.render(A, "3mo");
    expect(m.latest.hook).toMatchObject({ data: null, loading: true });
    await act(async () => resolve(ok(body("3mo"))));
    expect(m.latest.hook!.data?.street).toBe("3mo");
    await m.unmount();
  });

  it("retries after an error when reload() is called", async () => {
    let calls = 0;
    const m = mount(() =>
      ++calls === 1 ? { ok: false, status: 500, body: { error: "x" } } : ok(body("A"))
    );
    await m.render(A);
    expect(m.latest.hook).toMatchObject({ data: null, error: true });

    await act(async () => m.latest.hook!.reload());
    expect(calls).toBe(2);
    expect(m.latest.hook).toMatchObject({ loading: false, error: false });
    expect(m.latest.hook!.data?.street).toBe("A");
    await m.unmount();
  });

  it("is idle without a query", async () => {
    const m = mount(() => ok(body("A")));
    await m.render(null);
    expect(m.latest.hook).toMatchObject({ data: null, loading: false, error: false });
    expect(fetch).not.toHaveBeenCalled();
    await m.unmount();
  });
});
