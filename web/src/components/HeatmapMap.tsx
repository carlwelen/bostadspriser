"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { cellToBoundary, latLngToCell } from "h3-js";

import { AddressDrawer, type AddressSelection } from "./AddressDrawer";
import type { DistrictSlug } from "@/lib/districts";
import { fetchJson } from "./map/fetchJson";
import { buildHexPopup, buildPricePopup } from "./map/popups";

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

type PointFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    pricePerSqm: number;
    address: string;
    street: string;
    houseNumber: string | null;
    district: string;
    soldAt: string;
    source: string;
    sources: string;
    dedupKey: string | null;
  }
>;
type PointFC = GeoJSON.FeatureCollection<PointFeature["geometry"], PointFeature["properties"]>;
type HexFeature = GeoJSON.Feature<GeoJSON.Polygon, { count: number }>;
type HexFC = GeoJSON.FeatureCollection<GeoJSON.Polygon, { count: number }>;

const expr = (e: unknown) => e as mapboxgl.ExpressionSpecification;

// Price/m² → green-yellow-red ramp.
const PRICE_COLOR_RAMP = expr([
  "interpolate", ["linear"], ["get", "pricePerSqm"],
  80_000, "#1a9850",
  120_000, "#a6d96a",
  150_000, "#fee08b",
  180_000, "#fdae61",
  220_000, "#d73027",
]);

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

function sinceDaysToLabel(days: number): string {
  if (days <= 30) return "senaste 30 dagar";
  if (days <= 95) return "senaste 3 månader";
  if (days <= 380) return "senaste 12 månader";
  return `senaste ${days} dagar`;
}

function pointsToHexFC(points: PointFC): HexFC {
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

export function HeatmapMap({ districts, showHeatmap, mode, filters }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [points, setPoints] = useState<PointFC | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<AddressSelection | null>(null);

  // Initialize map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.error("NEXT_PUBLIC_MAPBOX_TOKEN is not set");
      return;
    }
    mapboxgl.accessToken = token;
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
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fetch points when filters change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    if (districts.length) params.set("districts", districts.join(","));
    if (filters?.priceMin) params.set("priceMin", String(filters.priceMin));
    if (filters?.priceMax) params.set("priceMax", String(filters.priceMax));
    if (filters?.rooms?.length) params.set("rooms", filters.rooms.join(","));
    if (filters?.sinceDays) params.set("sinceDays", String(filters.sinceDays));
    const qs = params.toString();
    // TODO(F30): import HeatmapResponse from @/lib/api-types once it lands on main.
    fetchJson<PointFC>(`/api/heatmap${qs ? `?${qs}` : ""}`)
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
  }, [districts, filters?.priceMin, filters?.priceMax, filters?.rooms, filters?.sinceDays]);

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
        paint: {
          "circle-radius": expr([
            "interpolate", ["linear"], ["zoom"],
            10, 28,
            12, 18,
            14, 10,
            16, 6,
            18, 5,
          ]),
          "circle-blur": expr([
            "interpolate", ["linear"], ["zoom"],
            10, 0.85,
            12, 0.55,
            14, 0.25,
            16, 0,
          ]),
          "circle-color": PRICE_COLOR_RAMP,
          "circle-opacity": expr([
            "interpolate", ["linear"], ["zoom"],
            10, 0.18,
            12, 0.32,
            14, 0.6,
            16, 0.9,
            18, 0.95,
          ]),
          "circle-stroke-width": expr([
            "interpolate", ["linear"], ["zoom"],
            14, 0,
            16, 1,
          ]),
          "circle-stroke-color": "#ffffff",
        },
      });

      const popup = new mapboxgl.Popup({ closeButton: false, offset: 8 });
      map.on("mouseenter", PRICE_POINT_LAYER, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const p = f.properties as PointFeature["properties"];
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
        const p = f.properties as PointFeature["properties"];
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
  }, [points, styleReady]);

  // (Re)build hex layer when frequency data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    if (!hexes) {
      // Mode is price — drop hex layers/source if they were previously added.
      if (map.getLayer(HEX_OUTLINE_LAYER)) map.removeLayer(HEX_OUTLINE_LAYER);
      if (map.getLayer(HEX_FILL_LAYER)) map.removeLayer(HEX_FILL_LAYER);
      if (map.getSource(HEX_SOURCE)) map.removeSource(HEX_SOURCE);
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

      // Hover + click for the hex pillars.
      const hexPopup = new mapboxgl.Popup({
        closeButton: false,
        offset: 8,
        className: "hex-popup",
      });
      map.on("mouseenter", HEX_FILL_LAYER, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { count: number };
        const period = sinceDaysRef.current
          ? sinceDaysToLabel(sinceDaysRef.current)
          : "hela perioden";
        hexPopup.setLngLat(e.lngLat).setDOMContent(buildHexPopup(p.count, period)).addTo(map);
      });
      map.on("mousemove", HEX_FILL_LAYER, (e) => {
        // Reposition the popup as the cursor moves over the hex.
        if (hexPopup.isOpen()) hexPopup.setLngLat(e.lngLat);
      });
      map.on("mouseleave", HEX_FILL_LAYER, () => {
        map.getCanvas().style.cursor = "";
        hexPopup.remove();
      });
    }
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
  const empty = !loading && !error && featureCount === 0;

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
      <div ref={containerRef} data-testid="map-container" className="h-full w-full" />

      {/* coverage / loading badge */}
      {!error && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-xs text-zinc-700 shadow-sm ring-1 ring-zinc-200 backdrop-blur">
          {loading ? (
            <>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
              Laddar försäljningar…
            </>
          ) : (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              {new Intl.NumberFormat("sv-SE").format(featureCount)} försäljningar i urvalet
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
          <div className="rounded-2xl bg-white/95 px-5 py-4 text-center text-sm text-red-700 shadow-md ring-1 ring-red-200">
            Kunde inte hämta data.
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
