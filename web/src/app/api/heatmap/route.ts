import { NextResponse } from "next/server";
import { heatmapPoints } from "@/lib/aggregations";
import type { HeatmapResponse } from "@/lib/api-types";
import {
  PUBLIC_CACHE,
  heatmapQuery,
  parseQuery,
  withApiErrors,
} from "@/lib/api-validation";

/** Five decimals of a degree is about 1 m: plenty for a point on a map, and shorter JSON. */
const round5 = (deg: number) => Math.round(deg * 1e5) / 1e5;

// The response is JSON, which `next start` gzips (Next's `compress` option is
// on by default); behind a CDN or reverse proxy that setting is theirs.
export const GET = withApiErrors("/api/heatmap", async (request: Request) => {
  const parsed = parseQuery(heatmapQuery, new URL(request.url).searchParams);
  if (!parsed.ok) return parsed.response;

  const { points, truncated } = await heatmapPoints(parsed.data);

  // Only what the map reads (popup, hover list, address drawer): no raw
  // per-source fields, no dedup key.
  const body: HeatmapResponse = {
    type: "FeatureCollection",
    truncated,
    features: points.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [round5(r.lng), round5(r.lat)] },
      properties: {
        pricePerSqm: r.pricePerSqm,
        address: r.houseNumber ? `${r.street} ${r.houseNumber}` : r.street,
        street: r.street,
        houseNumber: r.houseNumber,
        district: r.district,
        soldAt: r.soldAt.toISOString().slice(0, 10),
        // Mapbox stringifies array properties when added through GeoJSON;
        // pass through as a comma-joined string so the popup can split it.
        sources: r.sources.join(","),
      },
    })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": PUBLIC_CACHE } });
});
