"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ComposedChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SourceBadge } from "./SourceBadge";
import { registerModal } from "./map/focusTrap";
import type { Period } from "@/lib/api-types";
import { slugifyStreet } from "@/lib/text";
import { useAddressData } from "./map/useAddressData";

const PERIODS = [
  { value: "30d" as const, label: "30 dagar" },
  { value: "3mo" as const, label: "3 mån" },
  { value: "12mo" as const, label: "12 mån" },
  { value: "all" as const, label: "Allt" },
];

export type AddressSelection = {
  district: string;
  street: string;
  houseNumber: string | null;
  address: string;
  pricePerSqm: number;
  soldAt: string;
  sources: string[];
};

const SEK = new Intl.NumberFormat("sv-SE");

function formatBucket(b: string, granularity: "day" | "week" | "month"): string {
  const d = new Date(b);
  if (Number.isNaN(d.getTime())) return b;
  if (granularity === "day") {
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  }
  const month = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"][d.getUTCMonth()];
  if (granularity === "week") return `v.${weekOf(d)}`;
  return `${month} ${String(d.getUTCFullYear()).slice(2)}`;
}

function weekOf(d: Date): number {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round(diff / 7);
}

export function AddressDrawer({
  selection,
  onClose,
}: {
  selection: AddressSelection | null;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<Period>("12mo");
  const { data, loading, error, reload } = useAddressData(selection, period);
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const open = selection !== null;

  // Modal behaviour: focus moves into the drawer and returns to where it was
  // (the map canvas / body, or whatever opened it), the page behind doesn't
  // scroll, Esc closes and Tab stays inside.
  // `onClose` is a new function on most parent renders; it lives in a ref so a
  // re-render never re-runs this effect (which would move focus and unlock scroll).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    // Esc/Tab and the scroll lock go through the modal stack, so a search opened
    // over the drawer takes them over until it closes.
    const unregister = registerModal(() => panelRef.current, () => onCloseRef.current());
    return () => {
      const wasTop = unregister();
      if (wasTop && previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open]);

  const merged = useMemo(() => {
    if (!data) return [];
    const byBucket = new Map<string, { bucket: string; trend?: number; sale?: number }>();
    const sameDaySales: { bucket: string; sale: number }[] = [];
    for (const p of data.streetSeries) {
      byBucket.set(p.bucket, { bucket: p.bucket, trend: p.meanPricePerSqm });
    }
    for (const s of data.addressSales) {
      const existing = byBucket.get(s.soldAt) ?? { bucket: s.soldAt };
      if (existing.sale === undefined) {
        existing.sale = s.pricePerSqmSek;
        byBucket.set(s.soldAt, existing);
      } else {
        sameDaySales.push({ bucket: s.soldAt, sale: s.pricePerSqmSek });
      }
    }
    return [...byBucket.values(), ...sameDaySales].sort((a, b) =>
      String(a.bucket).localeCompare(String(b.bucket))
    );
  }, [data]);

  if (!selection) return null;

  const stats = data
    ? {
        latest: data.addressSales[0],
        addressCount: data.addressSales.length,
        streetMean:
          data.streetSeries.length > 0
            ? Math.round(
                data.streetSeries.reduce(
                  (s, p) => s + p.meanPricePerSqm * p.count,
                  0
                ) /
                  Math.max(
                    1,
                    data.streetSeries.reduce((s, p) => s + p.count, 0)
                  )
              )
            : null,
      }
    : null;

  return (
    <>
      <div
        className="backdrop-fade fixed inset-0 z-40 bg-zinc-950/20 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="drawer-enter fixed right-3 focus:outline-none top-3 bottom-3 z-50 flex w-[min(440px,92vw)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_24px_60px_-20px_rgb(15_23_42_/_0.18)]"
      >
        <header className="relative border-b border-zinc-200 bg-white px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                Adress
              </p>
              <h2 id={titleId} className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-900">
                {selection.address}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="-mr-1 rounded-md p-1.5 text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Stäng"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6 18 18" /><path d="M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <span className="tabular-nums">Senast {selection.soldAt}</span>
            <span aria-hidden className="text-zinc-300">·</span>
            <span className="font-semibold tabular-nums text-zinc-900">
              {SEK.format(selection.pricePerSqm)} kr/m²
            </span>
            <SourceBadge sources={selection.sources} size="xs" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <PeriodPills period={period} onChange={setPeriod} />

          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniStat
              label="Försäljningar"
              value={stats?.addressCount?.toString() ?? "—"}
              hint={selection.houseNumber ? "denna adress" : "hela gatan"}
            />
            <MiniStat
              label="Senaste pris"
              value={
                stats?.latest
                  ? `${SEK.format(stats.latest.pricePerSqmSek)} kr/m²`
                  : "—"
              }
              hint={stats?.latest?.soldAt}
            />
            <MiniStat
              label="Gatumedel"
              value={stats?.streetMean ? `${SEK.format(stats.streetMean)} kr/m²` : "—"}
              hint={`${data?.granularity ?? "—"} bucket`}
            />
          </div>

          <section className="mt-5">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <p>Pris/m² över tid</p>
              <p className="text-zinc-500">
                {selection.street} • {periodLabel(period)}
              </p>
            </div>
            <div className="mt-2 h-64 w-full">
              {error ? (
                <div
                  role="alert"
                  className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-red-200 bg-red-50/60 text-sm text-red-700"
                >
                  Kunde inte hämta data.
                  <button
                    type="button"
                    onClick={() => {
                      reload();
                      // The button disappears while loading; keep focus in the drawer.
                      panelRef.current?.focus();
                    }}
                    className="rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Försök igen
                  </button>
                </div>
              ) : loading ? (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 text-sm text-zinc-500">
                  Laddar…
                </div>
              ) : merged.length === 0 ? (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 text-sm text-zinc-500">
                  Ingen data i vald tidsperiod.
                </div>
              ) : (
                <ResponsiveContainer>
                  <ComposedChart data={merged} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <defs>
                      <linearGradient id="addrGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1d4ed8" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucket"
                      allowDuplicatedCategory={false}
                      tickFormatter={(b) => formatBucket(String(b), data?.granularity ?? "month")}
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${SEK.format(Math.round(Number(v) / 1000))}k`}
                      width={48}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 10,
                        border: "1px solid #e4e4e7",
                      }}
                      labelFormatter={(v) =>
                        formatBucket(String(v), data?.granularity ?? "month")
                      }
                      formatter={(value, name) => [
                        `${SEK.format(Number(value))} kr/m²`,
                        name === "trend" ? "Gatumedel" : "Försäljning",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="trend"
                      name="trend"
                      stroke="#1d4ed8"
                      strokeWidth={1.75}
                      fill="url(#addrGrad)"
                      connectNulls
                      dot={false}
                    />
                    <Scatter
                      dataKey="sale"
                      name="sale"
                      fill="#0b0d12"
                      stroke="white"
                      strokeWidth={2}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="mt-2 text-[10px] text-zinc-500">
              Linje = gatans medel · prickar = enskilda försäljningar på {selection.address}
            </p>
          </section>

          {data && data.addressSales.length > 0 && (
            <section className="mt-6">
              <p className="text-xs uppercase tracking-wider text-zinc-500">
                Försäljningar
              </p>
              <ul className="mt-2 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
                {data.addressSales.slice(0, 8).map((s, i) => (
                  <li
                    key={`${s.soldAt}-${i}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-zinc-900 tabular-nums">{s.soldAt}</p>
                      <p className="text-[11px] text-zinc-500">
                        {SEK.format(s.priceSek)} kr · {SEK.format(s.pricePerSqmSek)} kr/m²
                      </p>
                    </div>
                    <SourceBadge sources={s.sources} size="xs" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <a
            href={`/street/${selection.district}/${slugifyStreet(selection.street)}${
              selection.houseNumber ? `/${encodeURIComponent(selection.houseNumber)}` : ""
            }`}
            className="mt-6 inline-flex items-center gap-2 text-sm text-zinc-700 hover:text-zinc-900"
          >
            Öppna full sida
            <span aria-hidden>→</span>
          </a>
        </div>
      </aside>
    </>
  );
}

function PeriodPills({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Tidsperiod"
      className="inline-flex w-full overflow-hidden rounded-lg border border-zinc-200 bg-white p-0.5"
    >
      {PERIODS.map((p) => {
        const active = p.value === period;
        return (
          <button
            key={p.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.value)}
            className={
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition " +
              (active
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:text-zinc-900")
            }
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-zinc-900 leading-tight">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function periodLabel(p: Period): string {
  switch (p) {
    case "30d": return "senaste 30 dagar";
    case "3mo": return "senaste 3 månader";
    case "12mo": return "senaste 12 månader";
    case "all": return "all tid";
  }
}
