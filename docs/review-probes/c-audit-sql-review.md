# Fresh R review: C audit corrections

Reviewed at immutable tip `00647b00a32c9d12fa841da00302f49bd3712dfa`, 2026-10-25.
Scratch: `/tmp/review-c-audit`; isolated database `bostadspriser_test_r_c_audit`, port `3117`.
Read `AGENTS.md`, `docs/HANDOFF.md`, `CLAUDE.md`, `docs/reviewer-brief.md`, and the authoritative B59/B60/B62 backlog rows before review.

| Commit | Scope | Verdict | Findings |
| --- | --- | --- | --- |
| `08856836bcc73ddc405f973fc529a44a83ab2e5c` | B59 | **APPROVE** | None |
| `20daae326e91d5f124ec50d147c8b3b1d09a51b5` | B60 | **APPROVE** | None |
| `00647b00a32c9d12fa841da00302f49bd3712dfa` | B62 SQL only | **APPROVE** | None |

`6d39305` is the already-approved F45 dependency and was excluded from review. Preparation `582efba` must not be integrated. Python B62 `1b3c70e` was excluded. Only the three task commits above are approved here.

## Acceptance and independent probes

- **B59:** All integers 1–15 are retained; 7–15 contribute to one 7+ bucket. Fractional rooms use floor before the cap. Counts, means and median share the deduplicated positive-price population. Independent checks cover all fifteen integers, an exact cross-source duplicate, zero/negative prices, 1.9/6.9/7.9/14.9/15, absent areas, NULL/NaN rooms and both low/high outliers. The committed suite additionally checks non-uniform 7+ prices/areas, an empty accepted population and the empty-result case.
- **B60:** Sign filtering is in SQL after median aggregation and before ORDER/LIMIT. Zero belongs to neither direction; signed eligibility uses the existing rounded medians. Existing windows, thresholds, counts and enum/name tie order remain intact. Independent probes use even recent medians, an unchanged median with a radically different mean, duplicates, nonpositive prices, exact prior/recent boundaries, excluded old/future dates, and a UTC instant that is already the next date in Stockholm at the autumn DST transition. Both direction populations and limits 0/2/10 are checked. Swedish empty text accurately describes directional eligibility and visibly fits both desktop and Pixel 7.
- **B62 SQL:** Both axes must satisfy inclusive global geographic bounds before the cap; NULL, NaN, infinities and out-of-world values are rejected. An independent 9×9 coordinate matrix includes next-representable values just outside each bound, all nine combinations of -90/0/90 and -180/0/180, and partial/nonfinite pairs. API checks preserve `[lng,lat]` order, JSON shape and public cache headers. Another independent probe inserts 30,001 newer NaN-longitude rows plus one older valid pair and confirms one visible result with `truncated=false`. Existing tests verify 30k exact/overflow behavior, ordering ties, price/date/room/district/bbox filters and reduced payload shape.

No new backlog item is warranted by this review. No source or main checkout edits, commits or pushes were made. No provider network requests, protected-file changes or dev database mutations were made. Source commits introduce no schema changes.

## Reviewer validation

Run from `/tmp/review-c-audit/web`, with `TEST_DB_NAME=bostadspriser_test_r_c_audit E2E_PORT=3117`:

```sh
pnpm install --frozen-lockfile
pnpm test:int
pnpm exec vitest run --project unit src/app/insights/page.test.tsx
pnpm exec vitest run --project integration tests/integration/reviewer-c-audit.test.ts
pnpm e2e:build
pnpm exec playwright test e2e/reviewer-c-audit.spec.ts e2e/median.spec.ts e2e/copy.spec.ts --grep 'B60|insights'
```

Results: **301 existing integration tests + 1 existing UI unit test + 7 independent real-DB tests = 309 unique Vitest checks passed**. Production build passed. **6 focused browser checks passed**, across desktop and Pixel 7. The independent browser probe was then strengthened to require visible copy and await network idle before screenshots; both project instances passed again. This is 6 unique browser checks, not 8. Screenshots are `insights-desktop.png` and `insights-mobile.png` beside this report.

Logs: `integration-green.log`, `insights-green.log`, `probes-green.log`, `build.log`, `browser-green.log`, `browser-visible-green.log`. The author's full gates were inspected separately: B59 547/348/764, B60 553/352/764, B62 557/352/764 (`/tmp/c-audit-b59-gate.log`, `/tmp/c-audit-b60-f45-gate.log`, `/tmp/c-audit-b62-gate.log`). A full reviewer gate was not rerun; focused review includes the complete integration suite and the changed UI path.

## Production-only reversion proof

Tests were kept unchanged. Each task's production paths were restored to that task's parent, tests were run, and paths were restored to `00647b0` in a `finally` block. Every failure was a semantic assertion, not compilation, import or infrastructure failure.

| Task | Production paths restored to parent | Committed checks on parent | Independent checks on parent | Concrete failure |
| --- | --- | --- | --- | --- |
| B59 | `web/src/lib/aggregations.ts` | 3 failed, 1 passed | 2 failed | 7+ loses accepted 8–15 rows and changes aggregate populations |
| B60 | `web/src/lib/aggregations.ts`, `web/src/app/insights/page.tsx` | 6 failed, 9 passed | 3 failed | Wrong-sign/zero streets leak into both lists; old insufficient-data copy returns |
| B62 | `web/src/lib/aggregations.ts` | 3 failed, 7 passed | 2 failed | Invalid coordinates reach query/API; newer invalid rows consume cap and imply truncation |

Total: **19 meaningful reversion failures** (12 committed, 7 independent). Commands and exact exit statuses are in `reversion-commands.log`; automation is `run-reversions.py`. Full failure logs are `b59-reversion-{committed,independent}.log`, `b60-reversion-{committed,independent}.log`, `b62-reversion-{committed,independent}.log`.

```sh
# B59
git checkout 0885683^ -- web/src/lib/aggregations.ts
pnpm exec vitest run tests/integration/rooms-breakdown.test.ts
pnpm exec vitest run --project integration tests/integration/reviewer-c-audit.test.ts -t B59
git checkout 00647b0 -- web/src/lib/aggregations.ts
# B60
git checkout 20daae3^ -- web/src/lib/aggregations.ts web/src/app/insights/page.tsx
pnpm exec vitest run tests/integration/movers.test.ts src/app/insights/page.test.tsx
pnpm exec vitest run --project integration tests/integration/reviewer-c-audit.test.ts -t B60
git checkout 00647b0 -- web/src/lib/aggregations.ts web/src/app/insights/page.tsx
# B62
git checkout 00647b0^ -- web/src/lib/aggregations.ts
pnpm exec vitest run tests/integration/heatmap-coordinates.test.ts tests/integration/heatmap-payload.test.ts
pnpm exec vitest run --project integration tests/integration/reviewer-c-audit.test.ts -t B62
git checkout 00647b0 -- web/src/lib/aggregations.ts
```

After all reversions, the combined changed suites and independent probes passed **36/36** (`restored-green.log`):

```sh
pnpm exec vitest run tests/integration/rooms-breakdown.test.ts tests/integration/movers.test.ts tests/integration/heatmap-coordinates.test.ts tests/integration/heatmap-payload.test.ts tests/integration/reviewer-c-audit.test.ts src/app/insights/page.test.tsx
```

No production diff remained in the scratch checkout before cleanup. Scratch removal is recorded in `cleanup.log`.

## Independent probe source

The following files were written only in the scratch checkout, copied here for reproducibility, and not committed.

### reviewer-c-audit.test.ts

```ts
import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { heatmapPoints, roomsBreakdown, topMovers, HEATMAP_LIMIT } from "@/lib/aggregations";
import { GET } from "@/app/api/heatmap/route";
import { buildFixture, type FixtureListing } from "../fixtures/listings";
import { seed } from "../support/seed";

const [base] = buildFixture();
let serial = 0;
function sale(extra: Partial<FixtureListing> = {}): FixtureListing {
  const id = `review-${String(++serial).padStart(6, "0")}`;
  return { ...base, id, sourceId: id, dedupKey: id, ...extra };
}
afterAll(async () => prisma.$disconnect());

it("B59: all fifteen accepted integer counts survive, and 7+ shares one exact population", async () => {
  const rows = Array.from({ length: 15 }, (_, i) => sale({
    rooms: i + 1, pricePerSqmSek: BigInt((i + 1) * 10_000),
    areaSqm: (i + 1) * 10, priceSek: BigInt((i + 1) * 1_000_000),
  }));
  await seed(prisma, [...rows,
    { ...rows[14], id: "review-exact-copy", sourceId: "review-exact-copy", source: "booli" },
    sale({ rooms: 10, pricePerSqmSek: 0n }),
    sale({ rooms: 15, pricePerSqmSek: -1n }),
  ]);
  const buckets = await roomsBreakdown();
  expect(buckets.map(({ rooms, count }) => [rooms, count])).toEqual([
    [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 9],
  ]);
  expect(buckets[6]).toEqual({ rooms: 7, count: 9, meanPricePerSqm: 110_000,
    medianPricePerSqm: 110_000, meanAreaSqm: 110, meanPriceSek: 11_000_000 });
});

it("B59: fractional floors, absent areas and invalid legacy room values retain valid buckets", async () => {
  const valid = [1.9, 6.9, 7.9, 14.9, 15].map((rooms) => sale({ rooms, areaSqm: null }));
  const bad = [null, 0.9, 15.1, 999.9, -999.9, null].map((rooms) => sale({ rooms }));
  await seed(prisma, [...valid, ...bad]);
  await prisma.$executeRaw`UPDATE "Listing" SET rooms = 'NaN'::numeric WHERE id = ${bad[5].id}`;
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
  const buckets = await roomsBreakdown();
  expect(buckets.map(({ rooms, count, meanAreaSqm }) => [rooms, count, meanAreaSqm]))
    .toEqual([[1, 1, 0], [6, 1, 0], [7, 3, 0]]);
});

const AS_OF = new Date("2026-10-24T22:30:00Z"); // Stockholm is already Oct 25.
function movers(street: string, recent: number[], district: FixtureListing["district"] = "ostermalm") {
  return [
    ...Array.from({ length: 10 }, (_, i) => sale({ street, district,
      pricePerSqmSek: 100_000n, soldAt: new Date(i < 5 ? "2025-07-27" : "2026-07-26") })),
    ...recent.map((pps, i) => sale({ street, district, pricePerSqmSek: BigInt(pps),
      soldAt: new Date(i < 3 ? "2026-07-27" : "2026-10-25") })),
  ];
}

it("B60: signs use even medians, disjoint Stockholm boundaries, and deduplicated priced counts", async () => {
  const up = movers("Åsgränd", [110_000, 110_000, 110_000, 130_000, 130_000, 130_000]);
  const down = movers("Östgatan", [70_000, 70_000, 70_000, 90_000, 90_000, 90_000]);
  const unchanged = movers("S:t Noll", [1, 100_000, 100_000, 100_000, 100_000, 9_000_000]);
  await seed(prisma, [...up, ...down, ...unchanged,
    { ...up[15], id: "review-mover-copy", sourceId: "review-mover-copy", source: "booli" },
    sale({ street: "Åsgränd", soldAt: new Date("2026-10-26"), pricePerSqmSek: 1n }),
    sale({ street: "Åsgränd", soldAt: new Date("2025-07-26"), pricePerSqmSek: 9_000_000n }),
    sale({ street: "Åsgränd", soldAt: new Date("2026-10-25"), pricePerSqmSek: 0n }),
  ]);
  for (const [direction, street, median, pct] of [
    ["up", "Åsgränd", 120_000, 20], ["down", "Östgatan", 80_000, -20],
  ] as const) {
    const result = await topMovers(direction, 20, AS_OF);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ street, recentCount: 6, priorCount: 10, count: 16,
      recentMedianPricePerSqm: median, priorMedianPricePerSqm: 100_000, pctChange: pct });
  }
});

it.each(["up", "down"] as const)("B60: %s sign selection composes with limits and enum/name tie breaking", async (direction) => {
  const recent = Array(6).fill(direction === "up" ? 120_000 : 80_000);
  await seed(prisma, [
    ...movers("B", recent, "vasastan"), ...movers("A", recent, "vasastan"),
    ...movers("Z", recent, "ostermalm"), ...movers("Zero", Array(6).fill(100_000)),
    ...movers("Opposite", Array(6).fill(direction === "up" ? 50_000 : 200_000)),
  ]);
  expect((await topMovers(direction, 10, AS_OF)).map((r) => r.street)).toEqual(["Z", "A", "B"]);
  expect((await topMovers(direction, 2, AS_OF)).map((r) => r.street)).toEqual(["Z", "A"]);
  expect(await topMovers(direction, 0, AS_OF)).toEqual([]);
});

it("B62: axis cross-product excludes NaN/infinite/partial/outside pairs and accepts every world corner", async () => {
  const latitude = [null, "NaN", "Infinity", "-Infinity", "-90.00000000000001", "90.00000000000001", "-90", "0", "90"];
  const longitude = [null, "NaN", "Infinity", "-Infinity", "-180.00000000000003", "180.00000000000003", "-180", "0", "180"];
  const cases = latitude.flatMap((lat) => longitude.map((lng) => ({ lat, lng, row: sale() })));
  await seed(prisma, cases.map(({ row }) => row));
  for (const { lat, lng, row } of cases) {
    await prisma.$executeRaw`UPDATE "Listing" SET lat = ${lat}::float8, lng = ${lng}::float8 WHERE id = ${row.id}`;
  }
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
  const actual = await heatmapPoints();
  expect(actual.truncated).toBe(false);
  expect(actual.points.map(({ lat, lng }) => [lat, lng])).toEqual([
    [-90, -180], [-90, 0], [-90, 180], [0, -180], [0, 0], [0, 180],
    [90, -180], [90, 0], [90, 180],
  ]);
  const response = await GET(new Request("http://localhost/api/heatmap?bbox=-180,-90,180,90"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("public");
  const body = await response.json();
  expect(body.features).toHaveLength(9);
  expect(body.features.map((f: { geometry: { coordinates: number[] } }) => f.geometry.coordinates))
    .toEqual(actual.points.map(({ lat, lng }) => [lng, lat]));
});

it("B62: more than a cap of newer invalid rows cannot hide one older valid pair", async () => {
  await seed(prisma, [sale({ street: "Visible older", soldAt: new Date("2025-01-01") })]);
  await prisma.$executeRaw`
    INSERT INTO "Listing" (id, source, "sourceId", "dedupKey", street, district,
      rooms, "areaSqm", "priceSek", "pricePerSqmSek", "soldAt", lat, lng, raw)
    SELECT 'bad-' || g, 'hemnet', 'bad-' || g, 'bad-' || g, 'Bad newer', 'ostermalm',
      2, 50, 5000000, 100000, DATE '2026-10-25', 59, 'NaN'::float8, '{}'::jsonb
    FROM generate_series(1, ${HEATMAP_LIMIT + 1}::integer) g`;
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
  const result = await heatmapPoints();
  expect(result.truncated).toBe(false);
  expect(result.points.map((p) => p.street)).toEqual(["Visible older"]);
});

```

### reviewer-c-audit.spec.ts

```ts
import { test, expect } from "./fixtures";

test("B60 empty movers explain directional eligibility without page overflow", async ({ page, consoleErrors }, info) => {
  await page.goto("/insights");
  await expect(page.getByText("Inga gator i denna riktning med tillräckligt underlag.", { exact: true }))
    .toHaveCount(2);
  await expect(page.getByText("Inga gator i denna riktning med tillräckligt underlag.", { exact: true }).first())
    .toBeVisible();
  await expect(page.getByText("Inga gator i denna riktning med tillräckligt underlag.", { exact: true }).last())
    .toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Otillräckligt underlag.", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: `/tmp/r-c-audit/insights-${info.project.name}.png`, fullPage: true });
});

```
