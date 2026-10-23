import { NextResponse } from "next/server";
import { listAllStreets } from "@/lib/aggregations";
import type { StreetsAllResponse } from "@/lib/api-types";
import { parseQuery, streetsAllQuery, withApiErrors } from "@/lib/api-validation";

// The request is optional so the handler can be called without one.
export const GET = withApiErrors("/api/streets/all", async (request?: Request) => {
  const parsed = parseQuery(
    streetsAllQuery,
    request ? new URL(request.url).searchParams : new URLSearchParams()
  );
  if (!parsed.ok) return parsed.response;

  const body: StreetsAllResponse = await listAllStreets(parsed.data.limit);
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
  });
});
