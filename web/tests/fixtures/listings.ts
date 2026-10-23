import type { Prisma } from "@prisma/client";

// Deterministic Listing fixture shared by the integration tests and the e2e
// seed. No randomness: prices follow a fixed per-district base plus a per-month
// trend, so tests can assert exact aggregates.
//
// Shape:
//   - 4 districts x 3 streets x 12 months (2025-01 .. 2025-12), one Hemnet sale
//     per street per month on the 10th, house numbers cycling through HOUSES.
//   - DUPLICATE_PAIR: the same sale reported by Hemnet and Booli (same dedupKey);
//     the Booli copy has no coordinates. DedupedListing must collapse it.
//   - NO_COORDS: a Booli-only sale without lat/lng (hidden from the heatmap).
//   - Recent sales relative to "today" (RECENT_DAYS_AGO), one per district, so
//     `sinceDays`/90-day-window queries have data whenever the suite runs.

export type FixtureListing = Prisma.ListingCreateManyInput;

export const FIXTURE_STREETS = {
  ostermalm: ["Karlavägen", "Strandvägen", "Brahegatan"],
  vasastan: ["Odengatan", "Surbrunnsgatan", "Sankt Eriksgatan"],
  norrmalm: ["Drottninggatan", "Kungsgatan", "Vasagatan"],
  sodermalm: ["Götgatan", "Hornsgatan", "Ringvägen"],
} as const;

export type FixtureDistrict = keyof typeof FIXTURE_STREETS;

/** kr/m² in 2025-01 per district; each month adds MONTHLY_STEP. */
export const BASE_PPS: Record<FixtureDistrict, number> = {
  ostermalm: 150_000,
  vasastan: 120_000,
  norrmalm: 130_000,
  sodermalm: 110_000,
};
export const MONTHLY_STEP = 1_000;
/** Street i within a district is priced at base + i * STREET_STEP. */
export const STREET_STEP = 5_000;

const HOUSES = ["2", "10", "3A", "21"] as const;
const ROOMS = [1, 2, 3, 4, 5, 6] as const;

/** Approximate centroids, offset per street so points don't overlap. */
const CENTROID: Record<FixtureDistrict, [number, number]> = {
  ostermalm: [59.3378, 18.0805],
  vasastan: [59.3452, 18.0488],
  norrmalm: [59.3343, 18.0603],
  sodermalm: [59.3149, 18.0716],
};

export const RECENT_DAYS_AGO = 5;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

let seq = 0;
function row(input: {
  source?: string;
  district: FixtureDistrict;
  street: string;
  houseNumber: string | null;
  rooms: number;
  areaSqm: number;
  pricePerSqmSek: number;
  soldAt: Date;
  lat: number | null;
  lng: number | null;
  dedupKey?: string;
}): FixtureListing {
  seq += 1;
  const n = String(seq).padStart(4, "0");
  const source = input.source ?? "hemnet";
  return {
    id: `fx-${n}`,
    source,
    sourceId: `${source}-${n}`,
    dedupKey: input.dedupKey ?? `fx-dedup-${n}`,
    street: input.street,
    houseNumber: input.houseNumber,
    district: input.district,
    rooms: input.rooms,
    areaSqm: input.areaSqm,
    priceSek: BigInt(Math.round(input.pricePerSqmSek * input.areaSqm)),
    pricePerSqmSek: BigInt(input.pricePerSqmSek),
    soldAt: input.soldAt,
    lat: input.lat,
    lng: input.lng,
    raw: { fixture: true },
    scrapedAt: new Date("2026-01-01T00:00:00Z"),
    geocodedAt: input.lat === null ? null : new Date("2026-01-01T00:00:00Z"),
  };
}

export function monthlyPps(district: FixtureDistrict, streetIdx: number, month0: number) {
  return BASE_PPS[district] + streetIdx * STREET_STEP + month0 * MONTHLY_STEP;
}

/** Build the full fixture. Pure apart from the "recent" rows' dates. */
export function buildFixture(): FixtureListing[] {
  seq = 0;
  const rows: FixtureListing[] = [];
  for (const district of Object.keys(FIXTURE_STREETS) as FixtureDistrict[]) {
    const [lat0, lng0] = CENTROID[district];
    FIXTURE_STREETS[district].forEach((street, si) => {
      for (let m = 0; m < 12; m++) {
        const rooms = ROOMS[(si + m) % ROOMS.length];
        rows.push(
          row({
            district,
            street,
            houseNumber: HOUSES[m % HOUSES.length],
            rooms,
            areaSqm: 20 + rooms * 15,
            pricePerSqmSek: monthlyPps(district, si, m),
            soldAt: new Date(Date.UTC(2025, m, 10)),
            lat: lat0 + si * 0.002 + m * 0.0001,
            lng: lng0 + si * 0.002,
          })
        );
      }
    });
    rows.push(
      row({
        district,
        street: FIXTURE_STREETS[district][0],
        houseNumber: "2",
        rooms: 2,
        areaSqm: 50,
        pricePerSqmSek: BASE_PPS[district] + 20 * MONTHLY_STEP,
        soldAt: daysAgo(RECENT_DAYS_AGO),
        lat: lat0,
        lng: lng0,
      })
    );
  }

  // Same sale seen by both sources; the Booli copy lacks coordinates.
  const dupKey = "fx-dedup-duplicate";
  rows.push(
    row({
      district: "ostermalm",
      street: "Karlavägen",
      houseNumber: "10",
      rooms: 3,
      areaSqm: 70,
      pricePerSqmSek: 160_000,
      soldAt: new Date(Date.UTC(2025, 5, 20)),
      lat: 59.339,
      lng: 18.081,
      dedupKey: dupKey,
    }),
    row({
      source: "booli",
      district: "ostermalm",
      street: "Karlavägen",
      houseNumber: "10",
      rooms: 3,
      areaSqm: 70,
      pricePerSqmSek: 160_000,
      soldAt: new Date(Date.UTC(2025, 5, 20)),
      lat: null,
      lng: null,
      dedupKey: dupKey,
    }),
    // Booli-only, no coordinates.
    row({
      source: "booli",
      district: "sodermalm",
      street: "Götgatan",
      houseNumber: "22",
      rooms: 2,
      areaSqm: 45,
      pricePerSqmSek: 115_000,
      soldAt: new Date(Date.UTC(2025, 7, 15)),
      lat: null,
      lng: null,
    })
  );
  return rows;
}

/** Counts after DedupedListing collapses the duplicate pair. */
export const FIXTURE_COUNTS = {
  /** Raw "Listing" rows. */
  raw: 4 * 3 * 12 + 4 + 3,
  /** Rows visible through "DedupedListing". */
  deduped: 4 * 3 * 12 + 4 + 2,
  /** Deduped rows with coordinates (what /api/heatmap can return). */
  withCoords: 4 * 3 * 12 + 4 + 1,
} as const;
