import type { Period } from "@/lib/api-types";
import { DISTRICTS, type DistrictSlug } from "@/lib/districts";

// Map filters as they appear in the landing page URL (F15):
//   /?districts=vasastan,norrmalm&rooms=2,3&period=3mo&mode=frequency&heatmap=0
// Absent parameters mean the defaults; invalid values fall back to them.
// `districts=` (present but empty) means "none selected" and shows the empty
// state, which also makes that state linkable.

export type MapPeriod = Period;
export type MapMode = "price" | "frequency";

export type MapFilterState = {
  districts: DistrictSlug[];
  rooms: number[];
  period: MapPeriod;
  mode: MapMode;
  showHeatmap: boolean;
};

const ALL_DISTRICTS = DISTRICTS.map((d) => d.slug);
const PERIODS: MapPeriod[] = ["30d", "3mo", "12mo", "all"];
const MODES: MapMode[] = ["price", "frequency"];
const SINCE_DAYS: Record<MapPeriod, number | undefined> = {
  "30d": 30,
  "3mo": 90,
  "12mo": 365,
  all: undefined,
};

export const DEFAULT_FILTERS: MapFilterState = {
  districts: ALL_DISTRICTS,
  rooms: [],
  period: "12mo",
  mode: "price",
  showHeatmap: true,
};

export function periodToSinceDays(period: MapPeriod): number | undefined {
  return SINCE_DAYS[period];
}

function csv(value: string | null): string[] {
  return value === null || value === "" ? [] : value.split(",").map((s) => s.trim());
}

export function parseFilters(params: URLSearchParams): MapFilterState {
  const rawDistricts = params.get("districts");
  let districts = DEFAULT_FILTERS.districts;
  if (rawDistricts === "") {
    districts = [];
  } else if (rawDistricts !== null) {
    const wanted = new Set(csv(rawDistricts));
    const valid = ALL_DISTRICTS.filter((slug) => wanted.has(slug));
    if (valid.length > 0) districts = valid;
  }

  const rooms = [
    ...new Set(
      csv(params.get("rooms"))
        .filter((s) => /^[1-5]$/.test(s))
        .map(Number)
    ),
  ].sort((a, b) => a - b);

  const period = params.get("period") as MapPeriod;
  const mode = params.get("mode") as MapMode;

  return {
    districts,
    rooms,
    period: PERIODS.includes(period) ? period : DEFAULT_FILTERS.period,
    mode: MODES.includes(mode) ? mode : DEFAULT_FILTERS.mode,
    showHeatmap: params.get("heatmap") !== "0",
  };
}

const FILTER_KEYS = ["districts", "rooms", "period", "mode", "heatmap"];

/**
 * `current` with the five filter keys rewritten to `state` (defaults omitted)
 * and every other parameter (utm_*, ...) left alone. Returns the query string
 * without "?".
 */
export function applyFilters(current: URLSearchParams, state: MapFilterState): string {
  const next = new URLSearchParams(current);
  for (const key of FILTER_KEYS) next.delete(key);
  for (const [key, value] of new URLSearchParams(serializeFilters(state))) next.append(key, value);
  return next.toString();
}

/** Query string (no leading "?") holding only the non-default values. */
export function serializeFilters(state: MapFilterState): string {
  const p = new URLSearchParams();
  const sameDistricts =
    state.districts.length === ALL_DISTRICTS.length &&
    ALL_DISTRICTS.every((s) => state.districts.includes(s));
  if (!sameDistricts) {
    // Canonical order keeps the URL stable regardless of click order.
    p.set("districts", ALL_DISTRICTS.filter((s) => state.districts.includes(s)).join(","));
  }
  if (state.rooms.length) p.set("rooms", [...state.rooms].sort((a, b) => a - b).join(","));
  if (state.period !== DEFAULT_FILTERS.period) p.set("period", state.period);
  if (state.mode !== DEFAULT_FILTERS.mode) p.set("mode", state.mode);
  if (!state.showHeatmap) p.set("heatmap", "0");
  return p.toString();
}
