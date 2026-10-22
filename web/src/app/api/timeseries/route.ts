import { NextResponse } from "next/server";
import {
  districtTimeseries,
  streetTimeseries,
  type Granularity,
} from "@/lib/aggregations";
import { isDistrictSlug } from "@/lib/districts";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") ?? "district";
  const id = searchParams.get("id");
  const granularity = (searchParams.get("granularity") ?? "month") as Granularity;

  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  if (granularity !== "month" && granularity !== "year") {
    return NextResponse.json({ error: "granularity must be month|year" }, { status: 400 });
  }

  const headers = { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };

  if (scope === "district") {
    if (!isDistrictSlug(id)) {
      return NextResponse.json({ error: "invalid district slug" }, { status: 400 });
    }
    const points = await districtTimeseries(id, granularity);
    return NextResponse.json(points, { headers });
  }

  if (scope === "street") {
    // id format: <district>/<streetName>[/<houseNumber>]
    const parts = id.split("/");
    const [district, street, houseNumber] = parts;
    if (!district || !isDistrictSlug(district) || !street) {
      return NextResponse.json({ error: "invalid street id" }, { status: 400 });
    }
    const points = await streetTimeseries(
      district,
      decodeURIComponent(street),
      granularity,
      houseNumber ? decodeURIComponent(houseNumber) : undefined
    );
    return NextResponse.json(points, { headers });
  }

  return NextResponse.json({ error: "unsupported scope" }, { status: 400 });
}
