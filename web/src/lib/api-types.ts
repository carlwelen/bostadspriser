// Response shapes of the public JSON API. UI code imports these instead of
// re-declaring them; the route handlers are typed against them, so a shape
// change fails the typecheck on both sides.

import type { DistrictSlug } from "./districts";

export type { StreetSummary, TimeseriesPoint } from "./aggregations";
import type { StreetSummary, TimeseriesPoint } from "./aggregations";

/** Body of every 4xx/5xx response. `issues` is set on 400s only. */
export type ApiErrorBody = {
  error: string;
  issues?: ApiIssue[];
};

export type ApiIssue = {
  /** Query parameter the problem refers to, e.g. `sinceDays` ("" for the request as a whole). */
  path: string;
  message: string;
};

/** Time range (and bucket size) of the per-address drawer. */
export const PERIODS = ["30d", "3mo", "12mo", "all"] as const;
export type Period = (typeof PERIODS)[number];

/** The map's "5+" room chip is sent as `rooms=5` and means 5 rooms or more. */
export const OPEN_ENDED_ROOMS = 5;

export type AddressBucketGranularity = "day" | "week" | "month";

// GET /api/heatmap

export type HeatmapFeatureProperties = {
  pricePerSqm: number;
  /** "Street 12" or just the street when there is no house number. */
  address: string;
  street: string;
  houseNumber: string | null;
  district: DistrictSlug;
  /** ISO date (YYYY-MM-DD), Stockholm-local day. */
  soldAt: string;
  source: string;
  /** Every source that reported the sale, comma-joined (Mapbox stringifies arrays). */
  sources: string;
  dedupKey: string | null;
};

export type HeatmapFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [lng: number, lat: number] };
  properties: HeatmapFeatureProperties;
};

export type HeatmapResponse = {
  type: "FeatureCollection";
  features: HeatmapFeature[];
};

// GET /api/timeseries

export type TimeseriesResponse = TimeseriesPoint[];

// GET /api/streets, GET /api/streets/all

export type StreetsResponse = StreetSummary[];

export type StreetsAllItem = {
  district: DistrictSlug;
  street: string;
  slug: string;
  count: number;
  meanPricePerSqm: number;
};

export type StreetsAllResponse = StreetsAllItem[];

// GET /api/address

export type AddressSale = {
  soldAt: string;
  priceSek: number;
  pricePerSqmSek: number;
  sources: string[];
};

export type AddressResponse = {
  district: DistrictSlug;
  street: string;
  house: string | null;
  period: Period;
  granularity: AddressBucketGranularity;
  streetSeries: TimeseriesPoint[];
  addressSales: AddressSale[];
};
