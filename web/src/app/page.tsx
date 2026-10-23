"use client";

import { useMemo, useState } from "react";
import {
  HeatmapMap,
  type HeatmapFilters,
  type HeatmapMode,
} from "@/components/HeatmapMap";
import { BrandMark } from "@/components/BrandMark";
import { StreetSearch } from "@/components/StreetSearch";
import Link from "next/link";
import { DISTRICTS, type DistrictSlug } from "@/lib/districts";

const ALL_DISTRICTS = DISTRICTS.map((d) => d.slug);
const ROOM_OPTIONS = [1, 2, 3, 4, 5];
const SINCE_OPTIONS = [
  { label: "30 dagar", value: 30 },
  { label: "3 mån", value: 90 },
  { label: "12 mån", value: 365 },
  { label: "Allt", value: undefined as number | undefined },
];

export default function HomePage() {
  const [selected, setSelected] = useState<DistrictSlug[]>([...ALL_DISTRICTS]);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [mode, setMode] = useState<HeatmapMode>("price");
  const [rooms, setRooms] = useState<number[]>([]);
  const [sinceDays, setSinceDays] = useState<number | undefined>(365);

  const toggleDistrict = (slug: DistrictSlug) => {
    setSelected((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };
  const toggleRoom = (n: number) => {
    setRooms((prev) =>
      prev.includes(n) ? prev.filter((r) => r !== n) : [...prev, n]
    );
  };

  const filters: HeatmapFilters = useMemo(
    () => ({
      rooms: rooms.length ? rooms : undefined,
      sinceDays,
    }),
    [rooms, sinceDays]
  );

  return (
    // h-dvh, not h-screen: on mobile 100vh is the tallest viewport (URL bar hidden)
    // and would push the map's bottom edge below the fold.
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50">
      <TopNav />
      <div className="flex flex-1 gap-3 overflow-hidden p-3">
        <main className="relative flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <HeatmapMap
            districts={selected}
            showHeatmap={showHeatmap}
            mode={mode}
            filters={filters}
          />
        </main>
        <Sidebar
          selected={selected}
          onToggleDistrict={toggleDistrict}
          showHeatmap={showHeatmap}
          onToggleHeatmap={() => setShowHeatmap((v) => !v)}
          mode={mode}
          onChangeMode={setMode}
          rooms={rooms}
          onToggleRoom={toggleRoom}
          sinceDays={sinceDays}
          onSetSinceDays={setSinceDays}
        />
      </div>
    </div>
  );
}

function TopNav() {
  return (
    <div className="px-3 pt-3">
      <nav className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-5 py-3">
        <BrandMark />
        <div className="flex items-center gap-1 text-sm">
          <Link
            href="/insights"
            className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors duration-200 ease-out hover:bg-zinc-100 hover:text-zinc-900"
          >
            Insikter
          </Link>
          <Link
            href="/compare"
            className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors duration-200 ease-out hover:bg-zinc-100 hover:text-zinc-900"
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
  mode: HeatmapMode;
  onChangeMode: (mode: HeatmapMode) => void;
  rooms: number[];
  onToggleRoom: (n: number) => void;
  sinceDays: number | undefined;
  onSetSinceDays: (v: number | undefined) => void;
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
  sinceDays,
  onSetSinceDays,
}: SidebarProps) {
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Filter
          </h2>
          <span className="text-[11px] text-zinc-400">{selected.length} av {DISTRICTS.length}</span>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Stadsdelar</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {DISTRICTS.map((d) => {
            const on = selected.includes(d.slug);
            return (
              <button
                key={d.slug}
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
              onClick={() => rooms.forEach((r) => onToggleRoom(r))}
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
          {SINCE_OPTIONS.map((opt) => {
            const active = opt.value === sinceDays;
            return (
              <button
                key={opt.label}
                onClick={() => onSetSinceDays(opt.value)}
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
        {mode === "price" ? <PriceLegend /> : <FrequencyLegend />}
      </section>

      <p className="mt-auto pt-3 text-[10px] text-zinc-400">
        Källa: Hemnet sålda. Senaste 12 mån i Stockholms innerstad.
      </p>
    </aside>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: HeatmapMode;
  onChange: (m: HeatmapMode) => void;
}) {
  const options: Array<{ value: HeatmapMode; label: string; hint: string }> = [
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

function PriceLegend() {
  const stops: Array<[string, string]> = [
    ["#1a9850", "80k"],
    ["#a6d96a", "120k"],
    ["#fee08b", "150k"],
    ["#fdae61", "180k"],
    ["#d73027", "220k+"],
  ];
  return (
    <div className="text-xs">
      <p className="text-zinc-500">Pris/m² (kr)</p>
      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full">
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
