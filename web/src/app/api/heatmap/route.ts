import { NextResponse } from "next/server";
import { heatmapPoints } from "@/lib/aggregations";
import type { HeatmapResponse } from "@/lib/api-types";
import {
  PUBLIC_CACHE,
  heatmapQuery,
  parseQuery,
  withApiErrors,
} from "@/lib/api-validation";

export const GET = withApiErrors("/api/heatmap", async (request: Request) => {
  const parsed = parseQuery(heatmapQuery, new URL(request.url).searchParams);
  if (!parsed.ok) return parsed.response;

  const rows = await heatmapPoints(parsed.data);

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
