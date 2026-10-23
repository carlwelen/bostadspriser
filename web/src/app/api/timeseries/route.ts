import { NextResponse } from "next/server";
import { districtTimeseries, streetTimeseries } from "@/lib/aggregations";
import type { TimeseriesResponse } from "@/lib/api-types";
import {
  PUBLIC_CACHE,
  parseQuery,
  timeseriesQuery,
  withApiErrors,
} from "@/lib/api-validation";

export const GET = withApiErrors("/api/timeseries", async (request: Request) => {
  const parsed = parseQuery(timeseriesQuery, new URL(request.url).searchParams);
  if (!parsed.ok) return parsed.response;
  const q = parsed.data;

  const points: TimeseriesResponse =
    q.scope === "district"
      ? await districtTimeseries(q.district, q.granularity)
      : await streetTimeseries(q.district, q.street, q.granularity, q.houseNumber);
  return NextResponse.json(points, { headers: { "Cache-Control": PUBLIC_CACHE } });
});
