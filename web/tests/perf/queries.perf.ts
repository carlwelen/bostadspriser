import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  addressDrawerData,
  districtSummary,
  districtTimeseries,
  globalSummary,
  heatmapPoints,
  listAllStreets,
  listStreets,
  streetFromSlug,
  streetTimeseries,
  topMovers,
} from "@/lib/aggregations";
import { seedSynthetic } from "./synthetic";

// B21: time the hot queries against ~200k synthetic rows and EXPLAIN ANALYZE
// each statement they issue. Not part of the gate (own config, see
// vitest.config.mts). Output: a markdown table on stdout and the full plans in
// tests/perf/last-run.txt (untracked).

const RUNS = 5;
const D = "vasastan" as const;
const STREET = "Gata 7";
const HOUSE = "12";

type Case = { name: string; run: () => Promise<unknown> };

const cases: Case[] = [
  { name: "districtTimeseries", run: () => districtTimeseries(D, "month") },
  { name: "streetTimeseries", run: () => streetTimeseries(D, STREET, "month") },
  {
    name: "addressDrawerData (12mo)",
    run: () => addressDrawerData(D, STREET, HOUSE, { days: 365, bucket: "month" }),
  },
  { name: "heatmapPoints (district, 365d)", run: () => heatmapPoints({ districts: [D], sinceDays: 365 }) },
  { name: "heatmapPoints (everything)", run: () => heatmapPoints({}) },
  { name: "listStreets", run: () => listStreets(D) },
  { name: "listAllStreets", run: () => listAllStreets() },
  { name: "districtSummary", run: () => districtSummary(D) },
  { name: "globalSummary", run: () => globalSummary() },
  { name: "streetFromSlug", run: () => streetFromSlug(D, "gata-7") },
  { name: "topMovers", run: () => topMovers("up", 8) },
];

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const rows: string[] = [];
const plans: string[] = [];
let counts = "";

beforeAll(async () => {
  const seeded = await seedSynthetic(prisma);
  console.log(seeded ? "seeded synthetic data" : "synthetic data already present");
  const [{ raw, deduped }] = await prisma.$queryRaw<Array<{ raw: bigint; deduped: bigint }>>`
    SELECT (SELECT COUNT(*) FROM "Listing")::bigint AS raw,
           (SELECT COUNT(*) FROM "DedupedListing")::bigint AS deduped`;
  counts = `${raw} raw, ${deduped} deduplicated`;
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  const table = [
    `rows: ${counts}`,
    "",
    "| query | median wall ms | statements | EXPLAIN execution ms | planning ms |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
  // vitest swallows console output of passing runs in some modes: write a file too.
  writeFileSync(new URL("./last-run.txt", import.meta.url), `${table}\n\n${plans.join("\n\n")}`);
  console.log(`\n${table}`);
  await prisma.$disconnect();
});

describe("snapshot refresh", () => {
  it("refresh_deduped_listing()", async () => {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
      times.push(performance.now() - t0);
    }
    rows.push(`| refresh_deduped_listing() | ${median(times).toFixed(0)} | 1 | - | - |`);
  });
});

describe("hot queries", () => {
  for (const c of cases) {
    it(c.name, async () => {
      await c.run(); // warm up caches and the plan cache

      const times: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now();
        await c.run();
        times.push(performance.now() - t0);
      }

      // Capture the SQL the function issues, then EXPLAIN each statement.
      const original = prisma.$queryRaw.bind(prisma);
      const seen: Prisma.Sql[] = [];
      const spy = vi.spyOn(prisma, "$queryRaw").mockImplementation(((q: Prisma.Sql) => {
        seen.push(q);
        return original(q);
      }) as never);
      await c.run();
      spy.mockRestore();

      let exec = 0;
      let planning = 0;
      for (const q of seen) {
        const out = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
          `EXPLAIN (ANALYZE, BUFFERS) ${q.text}`,
          ...q.values
        );
        const text = out.map((r) => r["QUERY PLAN"]).join("\n");
        exec += Number(/Execution Time: ([\d.]+) ms/.exec(text)?.[1] ?? 0);
        planning += Number(/Planning Time: ([\d.]+) ms/.exec(text)?.[1] ?? 0);
        plans.push(`### ${c.name}\n${text}`);
      }
      rows.push(
        `| ${c.name} | ${median(times).toFixed(0)} | ${seen.length} | ${exec.toFixed(0)} | ${planning.toFixed(1)} |`
      );
    });
  }
});
