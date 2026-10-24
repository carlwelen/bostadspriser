import { afterAll, beforeEach, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { latestScrapeRuns, sourceFreshness } from "@/lib/aggregations";
import { buildFixture } from "../fixtures/listings";
import { seed } from "../support/seed";

beforeEach(() => seed(prisma, [{ ...buildFixture()[0], source: "booli" }]));
afterAll(() => prisma.$disconnect());

it("preserves old writer defaults and records absolute backfill progress", async () => {
  await prisma.$executeRaw`INSERT INTO "ScrapeRun" (source, district) VALUES ('old-writer', 'vasastan')`;
  const [legacy] = await prisma.$queryRaw<Array<{ kind: string; lastPage: number; since: Date | null; completeThrough: Date | null }>>`SELECT kind, "lastPage", since, "completeThrough" FROM "ScrapeRun"`;
  expect(legacy).toEqual({ kind: "legacy", lastPage: 0, since: null, completeThrough: null });
  await prisma.$executeRaw`INSERT INTO "ScrapeRun" (source, district, kind, "lastPage", since, "oldestSoldAt", pages, status)
    VALUES ('booli', 'vasastan', 'backfill', 42, '2025-01-01', '2025-06-01', 2, 'partial')`;
  const [progress] = await prisma.$queryRaw<Array<{ lastPage: number; pages: number; since: Date; oldestSoldAt: Date }>>`SELECT "lastPage", pages, since, "oldestSoldAt" FROM "ScrapeRun" WHERE kind = 'backfill'`;
  expect(progress.lastPage).toBe(42); // absolute page; pages counts this invocation only
  expect(progress.pages).toBe(2);
  expect(progress.since.toISOString().slice(0, 10)).toBe("2025-01-01");
  expect(progress.oldestSoldAt.toISOString().slice(0, 10)).toBe("2025-06-01");
});

it("never advertises completed or resumed historical backfills as recent freshness", async () => {
  await prisma.$executeRaw`INSERT INTO "ScrapeRun" (source, district, kind, status, "finishedAt", "lastPage") VALUES
    ('hemnet', 'vasastan', 'update', 'ok', '2026-03-01', 2),
    ('hemnet', 'vasastan', 'backfill', 'ok', '2026-04-01', 100),
    ('hemnet', 'vasastan', 'backfill', 'partial', '2026-04-02', 120),
    ('booli', 'vasastan', 'backfill', 'ok', '2026-04-03', 100),
    ('legacy', 'vasastan', 'legacy', 'ok', '2026-03-02', 0),
    ('manual', 'vasastan', 'scrape', 'partial', '2026-03-03', 1)`;
  const runs = await latestScrapeRuns();
  expect(runs.map((r) => r.source)).toEqual(["hemnet", "legacy", "manual"]);
  expect(runs[0].finishedAt).toBe("2026-03-01T00:00:00.000Z");
  const freshness = await sourceFreshness();
  expect(freshness.find((r) => r.source === "hemnet")?.lastSuccessAt).toBe("2026-03-01T00:00:00.000Z");
  expect(freshness.find((r) => r.source === "booli")?.lastSuccessAt).toBeNull();
  expect(freshness.find((r) => r.source === "booli")?.listingCount).toBe(1);
});

it("accepts completeThrough only for finished successful updates, and rejects negative pages", async () => {
  await prisma.$executeRaw`INSERT INTO "ScrapeRun" (source, district, kind, status, "finishedAt", "completeThrough")
    VALUES ('hemnet', 'vasastan', 'update', 'ok', '2026-04-01', '2026-03-31')`;
  for (const kind of ["legacy", "backfill", "scrape"]) {
    await expect(prisma.$executeRaw`INSERT INTO "ScrapeRun" (source, district, kind, status, "finishedAt", "completeThrough")
      VALUES ('hemnet', 'vasastan', ${kind}::"ScrapeKind", 'ok', '2026-04-01', '2026-03-31')`).rejects.toThrow();
  }
  await expect(prisma.$executeRaw`INSERT INTO "ScrapeRun" (source, district, kind, status, "completeThrough")
    VALUES ('hemnet', 'vasastan', 'update', 'partial', '2026-03-31')`).rejects.toThrow();
  await expect(prisma.$executeRaw`INSERT INTO "ScrapeRun" (source, district, "lastPage") VALUES ('x', 'vasastan', -1)`).rejects.toThrow();
});
