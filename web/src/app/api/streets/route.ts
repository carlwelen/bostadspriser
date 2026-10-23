import { NextResponse } from "next/server";
import { listStreets } from "@/lib/aggregations";
import type { StreetsResponse } from "@/lib/api-types";
import { PUBLIC_CACHE, parseQuery, streetsQuery, withApiErrors } from "@/lib/api-validation";

export const GET = withApiErrors("/api/streets", async (request: Request) => {
  const parsed = parseQuery(streetsQuery, new URL(request.url).searchParams);
  if (!parsed.ok) return parsed.response;
  const { district, limit } = parsed.data;

  const streets: StreetsResponse = await listStreets(district, limit);
  return NextResponse.json(streets, { headers: { "Cache-Control": PUBLIC_CACHE } });
});
