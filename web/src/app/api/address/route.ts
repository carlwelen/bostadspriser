import { NextResponse } from "next/server";
import { addressDrawerData } from "@/lib/aggregations";
import type {
  AddressBucketGranularity,
  AddressResponse,
  Period,
} from "@/lib/api-types";
import { PUBLIC_CACHE, addressQuery, parseQuery, withApiErrors } from "@/lib/api-validation";

const PERIOD_CONFIG: Record<
  Period,
  { days: number | null; granularity: AddressBucketGranularity }
> = {
  "30d": { days: 30, granularity: "day" },
  "3mo": { days: 90, granularity: "week" },
  "12mo": { days: 365, granularity: "month" },
  all: { days: null, granularity: "month" },
};

/**
 * Fetch the data backing the price-dot drawer:
 *   - per-address sales (rendered as dots),
 *   - street-level rolled-up series (rendered as the trend line).
 *
 * Period selects time range + bucket granularity. Address can be a single house
 * (when ?house= is set) or all houses on the street.
 */
export const GET = withApiErrors("/api/address", async (request: Request) => {
  const parsed = parseQuery(addressQuery, new URL(request.url).searchParams);
  if (!parsed.ok) return parsed.response;
  const { district, street, house, period } = parsed.data;

  const { days, granularity } = PERIOD_CONFIG[period];
  const { streetSeries, addressSales, streetSummary } = await addressDrawerData(district, street, house, {
    days,
    bucket: granularity,
  });

  const body: AddressResponse = {
    district,
    street,
    house: house ?? null,
    period,
    granularity,
    streetSummary,
    streetSeries,
    addressSales,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": PUBLIC_CACHE } });
});
