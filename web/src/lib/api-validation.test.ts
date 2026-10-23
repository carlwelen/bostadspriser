import { describe, expect, it } from "vitest";
import {
  addressQuery,
  heatmapQuery,
  parseQuery,
  streetsQuery,
  timeseriesQuery,
} from "./api-validation";

const q = (qs: string) => new URLSearchParams(qs);

describe("parseQuery", () => {
  it("returns typed data and applies defaults", () => {
    const r = parseQuery(streetsQuery, q("district=norrmalm"));
    expect(r).toEqual({ ok: true, data: { district: "norrmalm", limit: 200 } });
  });

  it("returns a 400 with path-tagged issues", async () => {
    const r = parseQuery(streetsQuery, q("district=norrmalm&limit=abc"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(400);
    const body = await r.response.json();
    expect(body.error).toBe("invalid query parameters");
    expect(body.issues).toEqual([{ path: "limit", message: "must be an integer" }]);
  });

  it("is not confused by prototype-ish query keys", () => {
    const r = parseQuery(streetsQuery, q("__proto__=x&constructor=y&district=norrmalm"));
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("uses the first value of a repeated key", () => {
    const r = parseQuery(streetsQuery, q("district=norrmalm&limit=5&limit=abc"));
    expect(r).toMatchObject({ ok: true, data: { limit: 5 } });
  });
});

describe("heatmapQuery", () => {
  it("normalises lists: dedupes districts, sorts and dedupes rooms", () => {
    const r = parseQuery(heatmapQuery, q("districts=vasastan,vasastan,norrmalm&rooms=3,1,3"));
    expect(r).toMatchObject({
      ok: true,
      data: { districts: ["vasastan", "norrmalm"], rooms: [1, 3] },
    });
  });

  it("parses bbox as numbers", () => {
    const r = parseQuery(heatmapQuery, q("bbox=17.9,59.2,18.2,59.4"));
    expect(r).toMatchObject({ ok: true, data: { bbox: [17.9, 59.2, 18.2, 59.4] } });
  });

  it("rejects whitespace and exponent forms Number() would accept", () => {
    expect(parseQuery(heatmapQuery, q("sinceDays=%2010")).ok).toBe(false);
    expect(parseQuery(heatmapQuery, q("priceMin=1e3")).ok).toBe(false);
    expect(parseQuery(heatmapQuery, q("bbox=0x10,1,2,3")).ok).toBe(false);
  });
});

describe("timeseriesQuery", () => {
  it("resolves a street id with an optional house number", () => {
    const r = parseQuery(
      timeseriesQuery,
      q(`scope=street&id=${encodeURIComponent("vasastan/Sankt%20Eriksgatan/3A")}`)
    );
    expect(r).toEqual({
      ok: true,
      data: {
        scope: "street",
        district: "vasastan",
        street: "Sankt Eriksgatan",
        houseNumber: "3A",
        granularity: "month",
      },
    });
  });
});

describe("addressQuery", () => {
  it("defaults the period to 12mo", () => {
    const r = parseQuery(addressQuery, q("district=vasastan&street=Odengatan"));
    expect(r).toMatchObject({ ok: true, data: { period: "12mo" } });
  });
});
