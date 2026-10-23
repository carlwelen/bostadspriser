import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "./fetchJson";

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns the parsed body of an ok response", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ a: 1 }) }));
    expect(await fetchJson("/x")).toEqual({ a: 1 });
  });

  it("throws on a non-ok response instead of returning its error body", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, json: async () => ({ error: "x" }) }));
    await expect(fetchJson("/x")).rejects.toThrow(/status 500/);
  });
});
