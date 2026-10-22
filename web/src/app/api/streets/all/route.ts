import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugifyStreet } from "@/lib/aggregations";

export async function GET() {
  const rows = await prisma.$queryRaw<
    Array<{ district: string; street: string; n: bigint; mean_pps: bigint }>
  >(Prisma.sql`
    SELECT district::text AS district,
           street,
           COUNT(*)::bigint               AS n,
           AVG("pricePerSqmSek")::bigint  AS mean_pps
    FROM "DedupedListing"
    WHERE "pricePerSqmSek" > 0
    GROUP BY district, street
    ORDER BY n DESC, street ASC
    LIMIT 4000
  `);

  return NextResponse.json(
    rows.map((r) => ({
      district: r.district,
      street: r.street,
      slug: slugifyStreet(r.street),
      count: Number(r.n),
      meanPricePerSqm: Number(r.mean_pps),
    })),
    {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    }
  );
}
