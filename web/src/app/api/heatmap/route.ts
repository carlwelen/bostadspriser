import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DistrictSlug } from "@/lib/districts";
import type { HeatmapResponse } from "@/lib/api-types";
import {
  PUBLIC_CACHE,
  heatmapQuery,
  parseQuery,
  withApiErrors,
} from "@/lib/api-validation";

type Row = {
  lat: number;
  lng: number;
  pricePerSqm: number;
  street: string;
  houseNumber: string | null;
  district: DistrictSlug;
  soldAt: Date;
  source: string;
  sources: string[];
  dedupKey: string | null;
};

export const GET = withApiErrors("/api/heatmap", async (request: Request) => {
  const parsed = parseQuery(heatmapQuery, new URL(request.url).searchParams);
  if (!parsed.ok) return parsed.response;
  const { districts, bbox, priceMin, priceMax, rooms, sinceDays } = parsed.data;

  const conds: Prisma.Sql[] = [
    Prisma.sql`lat IS NOT NULL`,
    Prisma.sql`lng IS NOT NULL`,
    Prisma.sql`"pricePerSqmSek" > 0`,
  ];
  if (districts && districts.length > 0) {
    conds.push(Prisma.sql`district::text IN (${Prisma.join(districts)})`);
  }
  if (bbox) {
    const [w, s, e, n] = bbox;
    conds.push(Prisma.sql`lng BETWEEN ${w} AND ${e}`);
    conds.push(Prisma.sql`lat BETWEEN ${s} AND ${n}`);
  }
  if (priceMin !== undefined) {
    conds.push(Prisma.sql`"pricePerSqmSek" >= ${priceMin}`);
  }
  if (priceMax !== undefined) {
    conds.push(Prisma.sql`"pricePerSqmSek" <= ${priceMax}`);
  }
  if (rooms && rooms.length > 0) {
    // Match exact integer-rounded room counts.
    conds.push(Prisma.sql`FLOOR(rooms) IN (${Prisma.join(rooms)})`);
  }
  if (sinceDays !== undefined) {
    conds.push(Prisma.sql`"soldAt" >= (CURRENT_DATE - ${sinceDays}::int)`);
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT lat, lng,
           "pricePerSqmSek"::int AS "pricePerSqm",
           street, "houseNumber", district::text AS district,
           "soldAt", source, sources, "dedupKey"
    FROM "DedupedListing"
    ${where}
    ORDER BY "soldAt" DESC
    LIMIT 50000
  `);

  const body: HeatmapResponse = {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: {
        pricePerSqm: r.pricePerSqm,
        address: r.houseNumber ? `${r.street} ${r.houseNumber}` : r.street,
        street: r.street,
        houseNumber: r.houseNumber,
        district: r.district,
        soldAt: r.soldAt.toISOString().slice(0, 10),
        source: r.source,
        // Mapbox stringifies array properties when added through GeoJSON;
        // pass through as a comma-joined string so the popup can split it.
        sources: (r.sources ?? [r.source]).join(","),
        dedupKey: r.dedupKey,
      },
    })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": PUBLIC_CACHE } });
});
