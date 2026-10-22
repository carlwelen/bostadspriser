import { NextResponse } from "next/server";
import { listStreets } from "@/lib/aggregations";
import { isDistrictSlug } from "@/lib/districts";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const district = searchParams.get("district");
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000);

  if (!district || !isDistrictSlug(district)) {
    return NextResponse.json({ error: "missing/invalid district" }, { status: 400 });
  }

  const streets = await listStreets(district, limit);
  return NextResponse.json(streets, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
