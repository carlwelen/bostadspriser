import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dedupKeysInMultipleClusters } from "@/lib/aggregations";
import type { FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

// B13 contract: all rows sharing a dedupKey carry one clusterId.
// dedupKeysInMultipleClusters() is the reference check for the matcher (B), which
// implements the same check in Python; the web side cannot be called from there.

const row = (id: string, extra: Partial<FixtureListing> = {}): FixtureListing => ({
  id,
  source: "hemnet",
  sourceId: id,
  dedupKey: id,
  street: "Odengatan",
  houseNumber: "7",
  district: "vasastan",
  rooms: 2,
  areaSqm: 50,
  priceSek: BigInt(5_000_000),
  pricePerSqmSek: BigInt(100_000),
  soldAt: new Date("2026-03-10T00:00:00Z"),
  lat: 59.34,
  lng: 18.05,
  raw: {},
  ...extra,
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("dedupKeysInMultipleClusters", () => {
  it("is empty when the contract holds", async () => {
    await seed(prisma, [
      row("a1", { dedupKey: "k1", clusterId: "c1" }),
      row("a2", { source: "booli", sourceId: "a2", dedupKey: "k1", clusterId: "c1" }),
      row("b1", { dedupKey: "k2", clusterId: "c1" }), // another key in the same cluster: fine
      row("solo", { dedupKey: "k3" }),
      row("legacy", { dedupKey: null }),
    ]);
    expect(await dedupKeysInMultipleClusters()).toEqual([]);
  });

  it("reports a dedupKey whose rows carry different clusterIds", async () => {
    await seed(prisma, [
      row("a1", { dedupKey: "k1", clusterId: "c2" }),
      row("a2", { source: "booli", sourceId: "a2", dedupKey: "k1", clusterId: "c1" }),
      row("fine", { dedupKey: "k2", clusterId: "c1" }),
    ]);
    expect(await dedupKeysInMultipleClusters()).toEqual([
      { dedupKey: "k1", clusterIds: ["c1", "c2"], unclusteredRows: 0 },
    ]);
  });

  it("reports a clustered dedupKey that still has unclustered copies", async () => {
    await seed(prisma, [
      row("a1", { dedupKey: "k1", clusterId: "c1" }),
      row("a2", { source: "booli", sourceId: "a2", dedupKey: "k1" }),
      row("a3", { source: "other", sourceId: "a3", dedupKey: "k1" }),
    ]);
    expect(await dedupKeysInMultipleClusters()).toEqual([
      { dedupKey: "k1", clusterIds: ["c1"], unclusteredRows: 2 },
    ]);
  });

  it("applies the limit and orders by dedupKey", async () => {
    await seed(prisma, [
      ...["k3", "k1", "k2"].flatMap((k) => [
        row(`${k}-a`, { dedupKey: k, clusterId: "c1" }),
        row(`${k}-b`, { source: "booli", sourceId: `${k}-b`, dedupKey: k, clusterId: "c2" }),
      ]),
    ]);
    expect((await dedupKeysInMultipleClusters(2)).map((r) => r.dedupKey)).toEqual(["k1", "k2"]);
  });
});
