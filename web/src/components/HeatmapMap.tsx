"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { cellToBoundary, latLngToCell } from "h3-js";

import { AddressDrawer, type AddressSelection } from "./AddressDrawer";
import type { DistrictSlug } from "@/lib/districts";
import type { HeatmapFeatureProperties, HeatmapResponse } from "@/lib/api-types";
import { fetchJson } from "./map/fetchJson";
import { createHexHandlers, type HexMapLike } from "./map/hexHandlers";
import { buildPricePopup } from "./map/popups";
import { formatSalesInSelection } from "./map/format";
import { DEFAULT_PRICE_BREAKS, computePriceBreaks, pricePointPaint } from "./map/priceRamp";

export type HeatmapMode = "price" | "frequency";

export type HeatmapFilters = {
  priceMin?: number;
  priceMax?: number;
  rooms?: number[];
  sinceDays?: number;
};

type Props = {
  districts: DistrictSlug[];
  showHeatmap: boolean;
  mode: HeatmapMode;
  filters?: HeatmapFilters;
  /** Reports the price breaks the map currently colours with (for the legend). */
  onPriceBreaks?: (breaks: number[]) => void;
};

const STOCKHOLM_INNER_CITY: [number, number] = [18.07, 59.335];

const POINT_SOURCE = "listings";
const HEX_SOURCE = "listings-hex";

const PRICE_POINT_LAYER = "price-points";
const HEX_FILL_LAYER = "hex-fill";
const HEX_OUTLINE_LAYER = "hex-outline";

// h3 resolution: 9 ≈ 175 m edge length. Big enough to read clearly at city
// zoom, small enough that inner Stockholm decomposes into block-sized buckets.
const H3_RESOLUTION = 9;

type HexFeature = GeoJSON.Feature<GeoJSON.Polygon, { count: number }>;
type HexFC = GeoJSON.FeatureCollection<GeoJSON.Polygon, { count: number }>;

const expr = (e: unknown) => e as mapboxgl.ExpressionSpecification;

// Hex count → sequential single-hue blue ramp tuned to the new accent.
// Pale at low counts so the basemap is still readable; darker at high counts
// so the busy areas pop against the calm pale ones.
const FREQUENCY_COLOR_RAMP = expr([
  "interpolate", ["linear"], ["get", "count"],
  1, "#dbeafe",   // blue-100
  3, "#93c5fd",   // blue-300
  6, "#3b82f6",   // blue-500
  12, "#1d4ed8",  // blue-700 (matches --accent)
  24, "#1e3a8a",  // blue-900
]);

function pointsToHexFC(points: HeatmapResponse): HexFC {
  const counts = new Map<string, number>();
  for (const f of points.features) {
    const [lng, lat] = f.geometry.coordinates;
    const cell = latLngToCell(lat, lng, H3_RESOLUTION);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  const features: HexFeature[] = [];
  for (const [cell, count] of counts) {
    const boundary = cellToBoundary(cell, true); // [lng, lat] order
    // Close the ring.
    boundary.push(boundary[0]);
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [boundary] },
      properties: { count },
    });
  }
  return { type: "FeatureCollection", features };
}

// Inlined at build time, so server and client agree on it.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function HeatmapMap({ districts, showHeatmap, mode, filters, onPriceBreaks }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const hexHandlersRef = useRef<ReturnType<typeof createHexHandlers> | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [points, setPoints] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedAddress, setSelectedAddress] = useState<AddressSelection | null>(null);

  // Initialize map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // A missing token is a configuration state, not a bug: the page shows an
    // in-app message (see the `!MAPBOX_TOKEN` banner below) rather than a console error.
    if (!MAPBOX_TOKEN) {
      console.warn("NEXT_PUBLIC_MAPBOX_TOKEN is not set; the map is disabled");
      return;
    }
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: STOCKHOLM_INNER_CITY,
      zoom: 12.8,
      pitch: 0,
      bearing: -8,
      antialias: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-left");
    map.on("load", () => setStyleReady(true));
    mapRef.current = map;

    return () => {
      hexHandlersRef.current?.dispose();
      hexHandlersRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fetch points when filters change.
  useEffect(() => {
    // No district selected: the API reads a missing `districts` as "all", so
    // don't ask. The empty state below tells the user why nothing is shown.
    if (districts.length === 0) {
      setPoints(null);
      setError(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    params.set("districts", districts.join(","));
    if (filters?.priceMin) params.set("priceMin", String(filters.priceMin));
    if (filters?.priceMax) params.set("priceMax", String(filters.priceMax));
    if (filters?.rooms?.length) params.set("rooms", filters.rooms.join(","));
    if (filters?.sinceDays) params.set("sinceDays", String(filters.sinceDays));
    const qs = params.toString();
    fetchJson<HeatmapResponse>(`/api/heatmap${qs ? `?${qs}` : ""}`)
      .then((fc) => {
        if (!cancelled) {
          setPoints(fc);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("heatmap fetch failed", err);
        if (!cancelled) {
          // Don't keep showing the previous selection's points as current.
          setPoints(null);
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [districts, filters?.priceMin, filters?.priceMax, filters?.rooms, filters?.sinceDays, reloadKey]);

  // Colour breaks follow the points on screen (quantiles, so a few outliers
  // can't flatten the ramp). The legend gets the same numbers.
  const priceBreaks = useMemo(
    () =>
      points
        ? computePriceBreaks(points.features.map((f) => f.properties.pricePerSqm))
        : DEFAULT_PRICE_BREAKS,
    [points]
  );
  useEffect(() => {
    onPriceBreaks?.(priceBreaks);
  }, [priceBreaks, onPriceBreaks]);

  // Aggregate to hex grid only when we actually need it.
  const hexes = useMemo(
    () => (points && mode === "frequency" ? pointsToHexFC(points) : null),
    [points, mode]
  );

  // Mount/update sources + layers once style is ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    if (!points) {
      // A failed fetch clears the points; don't leave the previous ones on the map.
      (map.getSource(POINT_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: [],
      });
      return;
    }

    // Point source — used by price layers.
    const pSrc = map.getSource(POINT_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (pSrc) pSrc.setData(points);
    else map.addSource(POINT_SOURCE, { type: "geojson", data: points });

    if (!map.getLayer(PRICE_POINT_LAYER)) {
      // The price layer plays two roles depending on zoom:
      //   - At low zoom: large, blurred, semi-transparent dots that overlap and
      //     "paint" a price field. Color is the price-ramp, so warm areas =
      //     high kr/m². Replaces the misleading density heatmap that always
      //     saturated to red in dense Stockholm.
      //   - At high zoom: small precise circles with a hairline white stroke,
      //     each one a clickable individual sale.
      map.addLayer({
        id: PRICE_POINT_LAYER,
        type: "circle",
        source: POINT_SOURCE,
        paint: expr(pricePointPaint(priceBreaks)) as mapboxgl.CirclePaint,
      });

      const popup = new mapboxgl.Popup({ closeButton: false, offset: 8 });
      map.on("mouseenter", PRICE_POINT_LAYER, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const p = f.properties as HeatmapFeatureProperties;
        popup.setLngLat([lng, lat]).setDOMContent(buildPricePopup(p)).addTo(map);
      });
      map.on("mouseleave", PRICE_POINT_LAYER, () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      // Click → open the address drawer. Each feature carries its own district
      // so the drawer routes correctly even when multiple districts are visible.
      map.on("click", PRICE_POINT_LAYER, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as HeatmapFeatureProperties;
        if (!p.district) return;
        setSelectedAddress({
          district: p.district,
          street: p.street,
          houseNumber: p.houseNumber,
          address: p.address,
          pricePerSqm: p.pricePerSqm,
          soldAt: p.soldAt,
          sources: (p.sources ?? "").split(",").filter(Boolean),
        });
      });
    }
    map.setPaintProperty(PRICE_POINT_LAYER, "circle-color", expr(pricePointPaint(priceBreaks)["circle-color"]));
  }, [points, styleReady, priceBreaks]);

  // (Re)build hex layer when frequency data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    if (!hexes) {
      // Mode is price — drop hex layers/source if they were previously added.
      const hadHexLayer = Boolean(map.getLayer(HEX_FILL_LAYER));
      if (map.getLayer(HEX_OUTLINE_LAYER)) map.removeLayer(HEX_OUTLINE_LAYER);
      if (hadHexLayer) map.removeLayer(HEX_FILL_LAYER);
      if (map.getSource(HEX_SOURCE)) map.removeSource(HEX_SOURCE);
      // Only when the layer really went away: this effect also runs on every
      // points change in price mode, where release() would reset the cursor
      // while the user hovers a price dot.
      if (hadHexLayer) hexHandlersRef.current?.release();
      return;
    }

    const src = map.getSource(HEX_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(hexes);
    else map.addSource(HEX_SOURCE, { type: "geojson", data: hexes });

    if (!map.getLayer(HEX_FILL_LAYER)) {
      map.addLayer({
        id: HEX_FILL_LAYER,
        type: "fill-extrusion",
        source: HEX_SOURCE,
        paint: {
          "fill-extrusion-color": FREQUENCY_COLOR_RAMP,
          "fill-extrusion-height": expr([
            "interpolate", ["linear"], ["get", "count"],
            1, 40,
            5, 240,
            15, 720,
            40, 1500,
          ]),
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.82,
          "fill-extrusion-vertical-gradient": true,
        },
      });

      // 1 px outline so adjacent hexes never blur into a single blob; gives
      // the map a crisp, "panel of cells" feel rather than a soft heatmap.
      map.addLayer({
        id: HEX_OUTLINE_LAYER,
        type: "line",
        source: HEX_SOURCE,
        paint: {
          "line-color": "#1e3a8a",
          "line-opacity": 0.35,
          "line-width": 0.6,
        },
      });

    }

    // Hover handlers for the hex pillars. Layer-scoped listeners survive
    // removeLayer/addLayer, so register them once per map, not per re-add.
    if (!hexHandlersRef.current) {
      hexHandlersRef.current = createHexHandlers(
        map as unknown as HexMapLike,
        HEX_FILL_LAYER,
        new mapboxgl.Popup({ closeButton: false, offset: 8, className: "hex-popup" }),
        () => sinceDaysRef.current
      );
    }
    hexHandlersRef.current.ensure();
  }, [hexes, styleReady]);

  // Keep the popup label fresh when the period filter changes mid-session.
  const sinceDaysRef = useRef(filters?.sinceDays);
  useEffect(() => {
    sinceDaysRef.current = filters?.sinceDays;
  }, [filters?.sinceDays]);

  // Toggle layer visibility based on mode + heatmap checkbox.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const setVis = (id: string, on: boolean) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      }
    };

    const inPrice = mode === "price";
    // The "Visa heatmap" toggle now hides the data overlay regardless of mode:
    // dots in price mode, hex pillars (+ outline) in frequency mode.
    setVis(PRICE_POINT_LAYER, inPrice && showHeatmap);
    setVis(HEX_FILL_LAYER, !inPrice && showHeatmap);
    setVis(HEX_OUTLINE_LAYER, !inPrice && showHeatmap);

    // Tilt the camera in frequency mode so the extrusions are legible.
    map.easeTo({
      pitch: inPrice ? 0 : 55,
      bearing: inPrice ? -8 : -22,
      duration: 600,
    });
  }, [mode, showHeatmap, styleReady]);

  const featureCount = points?.features.length ?? 0;
  const noDistricts = districts.length === 0;
  const empty = !loading && !error && !noDistricts && featureCount === 0;

  const recent = useMemo(() => {
    if (!points) return [] as Array<{ address: string; pricePerSqm: number; soldAt: string }>;
    return [...points.features]
      .map((f) => f.properties)
      .sort((a, b) => (a.soldAt < b.soldAt ? 1 : -1))
      .slice(0, 5);
  }, [points]);

  const SEK_FMT = useMemo(() => new Intl.NumberFormat("sv-SE"), []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-testid="map-container" tabIndex={-1} role="region" aria-label="Karta över försäljningar" className="h-full w-full" />

      {!MAPBOX_TOKEN && (
        <div role="status" className="absolute inset-x-3 top-3 z-20 flex justify-center">
          <p className="max-w-full break-words rounded-xl bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-900 shadow-md ring-1 ring-amber-200">
            Kartan kunde inte laddas: Mapbox-token saknas{" "}
            <span className="inline-block">
              (<code className="break-all">NEXT_PUBLIC_MAPBOX_TOKEN</code>).
            </span>
          </p>
        </div>
      )}

      {/* coverage / loading badge */}
      {!error && !noDistricts && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-xs text-zinc-700 shadow-sm ring-1 ring-zinc-200 backdrop-blur">
          {loading ? (
            <>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
              Laddar försäljningar…
            </>
          ) : (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              {formatSalesInSelection(featureCount)}
            </>
          )}
        </div>
      )}

      <AddressDrawer
        selection={selectedAddress}
        onClose={() => setSelectedAddress(null)}
      />

      {error && (
        <div role="alert" className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="pointer-events-auto rounded-2xl bg-white/95 px-5 py-4 text-center text-sm text-red-700 shadow-md ring-1 ring-red-200">
            <p>Kunde inte hämta data.</p>
            <button
              type="button"
              className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 font-medium hover:bg-red-50"
              onClick={() => {
                setReloadKey((key) => key + 1);
                containerRef.current?.focus();
              }}
            >
              Försök igen
            </button>
          </div>
        </div>
      )}

      {noDistricts && (
        <div role="status" className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="rounded-2xl bg-white/95 px-5 py-4 text-center text-sm text-zinc-700 shadow-md ring-1 ring-zinc-200">
            <p className="font-medium">Inga stadsdelar valda</p>
            <p className="mt-1 text-xs text-zinc-500">
              Välj minst en stadsdel i filtret för att se försäljningar.
            </p>
          </div>
        </div>
      )}

      {empty && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="rounded-2xl bg-white/95 px-5 py-4 text-center text-sm text-zinc-700 shadow-md ring-1 ring-zinc-200">
            <p className="font-medium">Inga försäljningar i urvalet ännu</p>
            <p className="mt-1 text-xs text-zinc-500">
              Justera stadsdelar, rum eller tidsperiod för att se data.
            </p>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="absolute bottom-3 right-3 z-10 hidden w-72 overflow-hidden rounded-2xl bg-white/90 shadow-md ring-1 ring-zinc-200 backdrop-blur md:block">
          <div className="border-b border-zinc-200/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Senaste försäljningar
          </div>
          <ul className="divide-y divide-zinc-100">
            {recent.map((r, i) => (
              <li key={`${r.address}-${r.soldAt}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-900">{r.address}</p>
                  <p className="text-[11px] text-zinc-500">{r.soldAt}</p>
                </div>
                <span className="shrink-0 tabular-nums text-zinc-700">
                  {SEK_FMT.format(r.pricePerSqm)} kr/m²
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
