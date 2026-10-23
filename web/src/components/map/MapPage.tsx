"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HeatmapMap, type HeatmapFilters } from "@/components/HeatmapMap";
import { BrandMark } from "@/components/BrandMark";
import { StreetSearch } from "@/components/StreetSearch";
import { PriceLegend } from "./PriceLegend";
import { DEFAULT_PRICE_BREAKS } from "./priceRamp";
import Link from "next/link";
import { DISTRICTS, type DistrictSlug } from "@/lib/districts";
import {
  applyFilters,
  parseFilters,
  periodToSinceDays,
  type MapFilterState,
  type MapMode,
  type MapPeriod,
} from "./filterParams";

const ROOM_OPTIONS = [1, 2, 3, 4, 5];
const PERIOD_OPTIONS: Array<{ label: string; phrase: string; value: MapPeriod }> = [
  { label: "30 dagar", phrase: "senaste 30 dagarna", value: "30d" },
  { label: "3 mån", phrase: "senaste 3 månaderna", value: "3mo" },
  { label: "12 mån", phrase: "senaste 12 månaderna", value: "12mo" },
  { label: "Allt", phrase: "hela perioden", value: "all" },
];

export function MapPage() {
  // The URL is the single source of truth for the filters (F15). The route is
  // dynamic (see app/page.tsx), so this also renders on the server. Changes use
  // history.replaceState rather than pushState: filtering refines one view
  // instead of navigating, so Back should leave the map, not step through
  // every toggle. Next syncs replaceState into useSearchParams.
  const qs = useSearchParams().toString();
  const state = useMemo(() => parseFilters(new URLSearchParams(qs)), [qs]);
  // Latest state, so two quick clicks before React re-renders don't clobber each other.
  const latest = useRef(state);
  latest.current = state;

  // Rewrites only the five filter keys: other parameters (utm_*) and the hash stay.
  const writeUrl = (next: MapFilterState) => {
    const search = applyFilters(window.location.search, next);
    const url = window.location.pathname + (search ? `?${search}` : "") + window.location.hash;
    if (url !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", url);
    }
  };
  const update = (patch: Partial<MapFilterState>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    writeUrl(next);
  };

  // Clean invalid or redundant parameters (?mode=3d) out of the URL once on load.
  useEffect(() => {
    writeUrl(latest.current);
  }, []);

  const toggleDistrict = (slug: DistrictSlug) => {
    const cur = latest.current.districts;
    update({ districts: cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug] });
  };
  const toggleRoom = (n: number) => {
    const cur = latest.current.rooms;
    update({ rooms: cur.includes(n) ? cur.filter((r) => r !== n) : [...cur, n] });
  };

  const [priceBreaks, setPriceBreaks] = useState(DEFAULT_PRICE_BREAKS);
  const sinceDays = periodToSinceDays(state.period);
  const filters: HeatmapFilters = useMemo(
    () => ({
      rooms: state.rooms.length ? state.rooms : undefined,
      sinceDays,
    }),
    [state.rooms, sinceDays]
  );

  return (
    // h-dvh, not h-screen: on mobile 100vh is the tallest viewport (URL bar hidden)
    // and would push the map's bottom edge below the fold.
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50">
      <TopNav />
      {/* Phones: map on top, sidebar scrolling below it. md+: side by side. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 md:flex-row">
        <main className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <HeatmapMap
            districts={state.districts}
            showHeatmap={state.showHeatmap}
            mode={state.mode}
            filters={filters}
            onPriceBreaks={setPriceBreaks}
          />
        </main>
        <Sidebar
          selected={state.districts}
          onToggleDistrict={toggleDistrict}
          showHeatmap={state.showHeatmap}
          onToggleHeatmap={() => update({ showHeatmap: !latest.current.showHeatmap })}
          mode={state.mode}
          onChangeMode={(mode) => update({ mode })}
          rooms={state.rooms}
          onToggleRoom={toggleRoom}
          onClearRooms={() => update({ rooms: [] })}
          period={state.period}
          onSetPeriod={(period) => update({ period })}
          priceBreaks={priceBreaks}
        />
      </div>
    </div>
  );
}

function TopNav() {
  return (
    <div className="px-3 pt-3">
      <nav className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 sm:px-5">
        {/* Below sm the "STHLM" tag goes; at 320 px the actions wrap under the brand. */}
        <div className="max-sm:[&_span.uppercase]:hidden">
          <BrandMark />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 text-sm sm:gap-1">
          <Link
            href="/insights"
            className="rounded-md px-2 py-1.5 text-zinc-600 transition-colors duration-200 ease-out hover:bg-zinc-100 hover:text-zinc-900 sm:px-3"
          >
            Insikter
          </Link>
          <Link
            href="/compare"
            className="rounded-md px-2 py-1.5 text-zinc-600 transition-colors duration-200 ease-out hover:bg-zinc-100 hover:text-zinc-900 sm:px-3"
          >
            Jämför
          </Link>
          <StreetSearch />
        </div>
      </nav>
    </div>
  );
}

type SidebarProps = {
  selected: DistrictSlug[];
  onToggleDistrict: (slug: DistrictSlug) => void;
  showHeatmap: boolean;
  onToggleHeatmap: () => void;
  mode: MapMode;
  onChangeMode: (mode: MapMode) => void;
  rooms: number[];
  onToggleRoom: (n: number) => void;
  onClearRooms: () => void;
  period: MapPeriod;
  onSetPeriod: (p: MapPeriod) => void;
  priceBreaks: number[];
};

function Sidebar({
  selected,
  onToggleDistrict,
  showHeatmap,
  onToggleHeatmap,
  mode,
  onChangeMode,
  rooms,
  onToggleRoom,
  onClearRooms,
  period,
  onSetPeriod,
  priceBreaks,
}: SidebarProps) {
  // Phones show only a slice of the sidebar; fade + label say there is more.
  const asideRef = useRef<HTMLElement | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const measure = useCallback(() => {
    const el = asideRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Showing the hint takes room from the sidebar, so use two thresholds;
    // otherwise a sidebar that overflows by a few px would flicker.
    setMoreBelow((shown) => (shown ? remaining > 4 : remaining > 28));
  }, []);
  useEffect(() => {
    measure();
    const el = asideRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="flex max-h-[45%] w-full shrink-0 flex-col md:max-h-none md:w-80">
    <aside
      ref={asideRef}
      onScroll={measure}
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5"
    >
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Filter
          </h2>
          <span className="text-[11px] text-zinc-500">{selected.length} av {DISTRICTS.length}</span>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Stadsdelar</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {DISTRICTS.map((d) => {
            const on = selected.includes(d.slug);
            return (
              <button
                key={d.slug}
                aria-pressed={on}
                onClick={() => onToggleDistrict(d.slug)}
                className={
                  "rounded-lg border px-3 py-2 text-left text-sm transition " +
                  (on
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300")
                }
              >
                {d.displayName}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <p className="text-xs text-zinc-500">Antal rum</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ROOM_OPTIONS.map((n) => {
            const on = rooms.includes(n);
            return (
              <button
                key={n}
                aria-pressed={on}
                onClick={() => onToggleRoom(n)}
                className={
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition " +
                  (on
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300")
                }
              >
                {n === 5 ? "5+" : n}
              </button>
            );
          })}
          {rooms.length > 0 && (
            <button
              onClick={onClearRooms}
              className="text-[11px] text-zinc-500 underline-offset-2 hover:underline"
            >
              rensa
            </button>
          )}
        </div>
      </section>

      <section>
        <p className="text-xs text-zinc-500">Tidsperiod</p>
        <div className="mt-2 inline-flex w-full overflow-hidden rounded-lg border border-zinc-200">
          {PERIOD_OPTIONS.map((opt) => {
            const active = opt.value === period;
            return (
              <button
                key={opt.label}
                aria-pressed={active}
                onClick={() => onSetPeriod(opt.value)}
                className={
                  "flex-1 px-2 py-1.5 text-xs transition " +
                  (active
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-50")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      <hr className="border-zinc-200" />

      <section>
        <p className="text-xs text-zinc-500">Snabblänkar</p>
        <ul className="mt-2 space-y-1 text-sm">
          {DISTRICTS.map((d) => (
            <li key={d.slug}>
              <a
                href={`/district/${d.slug}`}
                className="flex items-center justify-between rounded px-2 py-1.5 text-zinc-700 hover:bg-zinc-100"
              >
                <span>{d.displayName}</span>
                <span aria-hidden className="text-zinc-300">›</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <hr className="border-zinc-200" />

      <section className="space-y-3">
        <ModeSwitch mode={mode} onChange={onChangeMode} />
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 hover:border-zinc-300">
          <span className="text-sm font-medium text-zinc-800">Visa heatmap</span>
          <input
            type="checkbox"
            checked={showHeatmap}
            onChange={onToggleHeatmap}
            className="h-4 w-4 accent-zinc-900"
          />
        </label>
        {mode === "price" ? <PriceLegend breaks={priceBreaks} /> : <FrequencyLegend />}
      </section>

      <p data-testid="source-note" className="mt-auto pt-3 text-[11px] text-zinc-500">
        Källa: sålda bostäder från Hemnet och Booli, {PERIOD_OPTIONS.find((o) => o.value === period)?.phrase} i
        Stockholms innerstad.
      </p>
    </aside>
    {moreBelow && (
      <p
        data-testid="sidebar-more"
        aria-hidden
        className="shrink-0 pt-1 text-center text-[11px] font-medium text-zinc-600"
      >
        Fler filter ↓
      </p>
    )}
    </div>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
}) {
  const options: Array<{ value: MapMode; label: string; hint: string }> = [
    { value: "price", label: "Pris", hint: "kr/m²" },
    { value: "frequency", label: "Frekvens", hint: "antal sålda" },
  ];
  return (
    <div>
      <p className="text-xs text-zinc-500">Visualisering</p>
      <div className="mt-2 inline-flex w-full rounded-lg border border-zinc-200 p-0.5">
        {options.map((opt) => {
          const active = opt.value === mode;
          return (
            <button
              key={opt.value}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={
                "flex-1 rounded-md px-3 py-1.5 text-sm transition " +
                (active
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:text-zinc-900")
              }
              title={opt.hint}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FrequencyLegend() {
  const stops: Array<[string, string]> = [
    ["#dbeafe", "1"],
    ["#93c5fd", "3"],
    ["#3b82f6", "6"],
    ["#1d4ed8", "12"],
    ["#1e3a8a", "24+"],
  ];
  return (
    <div className="text-xs">
      <p className="text-zinc-500">Antal sålda per ~175 m hex</p>
      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full ring-1 ring-zinc-200">
        {stops.map(([color]) => (
          <div key={color} style={{ background: color }} className="flex-1" />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        {stops.map(([, label]) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
