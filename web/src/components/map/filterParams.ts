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
    const wanted = new Set(csv(rawDistricts).map((x) => x.toLowerCase()));
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
 * `current` (a query string, with or without "?", or URLSearchParams) with the
 * five filter keys rewritten to `state` (defaults omitted). Every other
 * parameter (utm_*, ...) is kept verbatim: it is not decoded and re-encoded.
 * Returns the query string without "?".
 */
export function applyFilters(current: string | URLSearchParams, state: MapFilterState): string {
  const raw = typeof current === "string" ? current.replace(/^\?/, "") : current.toString();
  const kept = raw.split("&").filter((segment) => {
    if (segment === "") return false;
    let key = segment.split("=")[0];
    try {
      key = decodeURIComponent(key.replace(/\+/g, " "));
    } catch {
      /* keep the raw key */
    }
    return !FILTER_KEYS.includes(key);
  });
  return [...kept, ...filterSegments(state)].join("&");
}

/** Query string (no leading "?") holding only the non-default values. */
export function serializeFilters(state: MapFilterState): string {
  return filterSegments(state).join("&");
}

// Values are slugs, digits and fixed words, so nothing needs escaping; lists
// keep readable commas (URLSearchParams would write %2C).
function filterSegments(state: MapFilterState): string[] {
  const out: string[] = [];
  const sameDistricts =
    state.districts.length === ALL_DISTRICTS.length &&
    ALL_DISTRICTS.every((s) => state.districts.includes(s));
  if (!sameDistricts) {
    // Canonical order keeps the URL stable regardless of click order.
    out.push(`districts=${ALL_DISTRICTS.filter((s) => state.districts.includes(s)).join(",")}`);
  }
  if (state.rooms.length) out.push(`rooms=${[...state.rooms].sort((a, b) => a - b).join(",")}`);
  if (state.period !== DEFAULT_FILTERS.period) out.push(`period=${state.period}`);
  if (state.mode !== DEFAULT_FILTERS.mode) out.push(`mode=${state.mode}`);
  if (!state.showHeatmap) out.push("heatmap=0");
  return out;
}
