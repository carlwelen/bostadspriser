import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isDistrictSlug } from "@/lib/districts";

type Row = {
  lat: number;
  lng: number;
  pricePerSqm: number;
  street: string;
  houseNumber: string | null;
  district: string;
  soldAt: Date;
  source: string;
  sources: string[];
  dedupKey: string | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const districtsParam = searchParams.get("districts");
  const districts = districtsParam
    ? districtsParam.split(",").filter(isDistrictSlug)
    : null;

  // Optional bounding box: bbox=west,south,east,north
  const bboxParam = searchParams.get("bbox");
  let bbox: [number, number, number, number] | null = null;
  if (bboxParam) {
    const parts = bboxParam.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      bbox = parts as [number, number, number, number];
    }
  }

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
  const priceMin = Number(searchParams.get("priceMin"));
  const priceMax = Number(searchParams.get("priceMax"));
  if (Number.isFinite(priceMin) && priceMin > 0) {
    conds.push(Prisma.sql`"pricePerSqmSek" >= ${priceMin}`);
  }
  if (Number.isFinite(priceMax) && priceMax > 0) {
    conds.push(Prisma.sql`"pricePerSqmSek" <= ${priceMax}`);
  }
  const roomsParam = searchParams.get("rooms");
  if (roomsParam) {
    const rooms = roomsParam
      .split(",")
      .map((r) => Number(r))
      .filter(Number.isFinite);
    if (rooms.length > 0) {
      // Match exact integer-rounded room counts. "5+" is encoded as 5 plus
      // an extra `&rooms=5plus` flag handled below.
      conds.push(Prisma.sql`FLOOR(rooms) IN (${Prisma.join(rooms)})`);
    }
  }
  if (searchParams.get("sinceDays")) {
    const days = Math.max(1, Math.min(3650, Number(searchParams.get("sinceDays"))));
    conds.push(Prisma.sql`"soldAt" >= (CURRENT_DATE - ${days}::int)`);
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

  return NextResponse.json(
    {
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
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}
