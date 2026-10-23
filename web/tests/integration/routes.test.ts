import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as heatmapGET } from "@/app/api/heatmap/route";
import { GET as timeseriesGET } from "@/app/api/timeseries/route";
import { GET as streetsGET } from "@/app/api/streets/route";
import { GET as streetsAllGET } from "@/app/api/streets/all/route";
import { GET as addressGET } from "@/app/api/address/route";
import { FIXTURE_COUNTS } from "../fixtures/listings";
import { seed } from "../support/seed";

// Route handlers are plain functions of a Request; call them directly.
const req = (path: string) => new Request(`http://localhost${path}`);

beforeAll(async () => {
  await seed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("/api/heatmap", () => {
  it("returns a FeatureCollection of deduped rows with coordinates", async () => {
    const res = await heatmapGET(req("/api/heatmap"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(FIXTURE_COUNTS.withCoords);
    const f = body.features[0];
    expect(f.geometry.type).toBe("Point");
    expect(f.properties).toHaveProperty("pricePerSqm");
  });

  it("filters by district", async () => {
    const res = await heatmapGET(req("/api/heatmap?districts=vasastan"));
    const body = await res.json();
    expect(body.features.length).toBe(37);
    expect(body.features.every((f: { properties: { district: string } }) => f.properties.district === "vasastan")).toBe(true);
  });
});

describe("/api/timeseries", () => {
  it("rejects a missing id", async () => {
    const res = await timeseriesGET(req("/api/timeseries?scope=district"));
    expect(res.status).toBe(400);
  });

  it("returns a district series", async () => {
    const res = await timeseriesGET(req("/api/timeseries?scope=district&id=sodermalm"));
    expect(res.status).toBe(200);
    const points = await res.json();
    expect(points.length).toBeGreaterThanOrEqual(12);
  });

  it("returns a street series", async () => {
    const res = await timeseriesGET(
      req(`/api/timeseries?scope=street&id=${encodeURIComponent("vasastan/Odengatan")}&granularity=year`)
    );
    expect(res.status).toBe(200);
    const points = await res.json();
    expect(points.find((p: { bucket: string }) => p.bucket === "2025-01-01")?.count).toBe(12);
  });
});

describe("/api/streets", () => {
  it("requires a valid district", async () => {
    expect((await streetsGET(req("/api/streets"))).status).toBe(400);
    expect((await streetsGET(req("/api/streets?district=gamla-stan"))).status).toBe(400);
  });

  it("rejects prototype keys as district (B30)", async () => {
    const res = await streetsGET(req("/api/streets?district=toString"));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("lists streets for a district", async () => {
    const res = await streetsGET(req("/api/streets?district=norrmalm"));
    const body = await res.json();
    expect(body.map((s: { street: string }) => s.street).sort()).toEqual([
      "Drottninggatan",
      "Kungsgatan",
      "Vasagatan",
    ]);
  });

  it("lists streets across all districts", async () => {
    const res = await streetsAllGET();
    const body = await res.json();
    expect(body).toHaveLength(12);
  });
});

describe("/api/address", () => {
  it("validates inputs", async () => {
    expect((await addressGET(req("/api/address?street=Odengatan"))).status).toBe(400);
    expect((await addressGET(req("/api/address?district=vasastan"))).status).toBe(400);
    expect(
      (await addressGET(req("/api/address?district=vasastan&street=Odengatan&period=5y"))).status
    ).toBe(400);
  });

  it("returns the street series for the whole history", async () => {
    const res = await addressGET(req("/api/address?district=vasastan&street=Odengatan&period=all"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.granularity).toBe("month");
    expect(body.streetSeries.length).toBeGreaterThanOrEqual(12);
    expect(body.addressSales.length).toBe(13);
  });
});
