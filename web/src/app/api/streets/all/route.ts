import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugifyStreet } from "@/lib/aggregations";
import type { DistrictSlug } from "@/lib/districts";
import type { StreetsAllResponse } from "@/lib/api-types";
import { parseQuery, streetsAllQuery, withApiErrors } from "@/lib/api-validation";

// The request is optional so the handler can be called without one.
export const GET = withApiErrors("/api/streets/all", async (request?: Request) => {
  const parsed = parseQuery(
    streetsAllQuery,
    request ? new URL(request.url).searchParams : new URLSearchParams()
  );
  if (!parsed.ok) return parsed.response;
  const { limit } = parsed.data;

  const rows = await prisma.$queryRaw<
    Array<{ district: DistrictSlug; street: string; n: bigint; mean_pps: bigint }>
  >(Prisma.sql`
    SELECT district::text AS district,
           street,
           COUNT(*)::bigint               AS n,
           AVG("pricePerSqmSek")::bigint  AS mean_pps
    FROM "DedupedListing"
    WHERE "pricePerSqmSek" > 0
    GROUP BY district, street
    ORDER BY n DESC, street ASC
    LIMIT ${limit}
  `);

  const body: StreetsAllResponse = rows.map((r) => ({
    district: r.district,
    street: r.street,
    slug: slugifyStreet(r.street),
    count: Number(r.n),
    meanPricePerSqm: Number(r.mean_pps),
  }));
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
  });
});
