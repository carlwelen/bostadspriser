"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useMemo } from "react";
import type { Granularity } from "@/lib/aggregations";
import { ChartDataTable } from "./ChartDataTable";
import { CHART_COLORS } from "./chartColors";
import { formatSales } from "./plural";
import {
  buildChartData,
  countKey,
  isLowSample,
  pickTicks,
  meanKey,
  type ChartRow,
  type ChartSeries,
} from "./priceChartData";

export type Series = {
  name: string;
  color?: string;
  points: ChartSeries["points"];
};

const SEK = new Intl.NumberFormat("sv-SE");
const MAX_X_TICKS = 8;
const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** Axis label for a bucket start (UTC ms). Monthly: "apr 26". Yearly: "2025". */
export function formatBucket(t: number, granularity: Granularity = "month"): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  const year = d.getUTCFullYear();
  if (granularity === "year") return String(year);
  return `${MONTHS[d.getUTCMonth()]} ${String(year).slice(2)}`;
}

/** Tooltip heading for a bucket start: "april 2026" or "2025". */
function formatBucketLong(t: number, granularity: Granularity): string {
  if (granularity === "year") return String(new Date(t).getUTCFullYear());
  return new Date(t).toLocaleDateString("sv-SE", { month: "long", year: "numeric", timeZone: "UTC" });
}

type TooltipEntry = { name?: string | number; value?: number | string; color?: string; payload?: ChartRow };

function ChartTooltip({
  active,
  payload,
  label,
  granularity,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number | string;
  granularity: Granularity;
}) {
  const entries = (payload ?? []).filter((e) => typeof e.value === "number");
  if (!active || entries.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-zinc-200 bg-white px-3 py-2 text-xs shadow-[0_4px_16px_rgb(0_0_0_/_0.04)]">
      <p className="mb-1.5 font-medium capitalize text-zinc-900">
        {formatBucketLong(Number(label), granularity)}
      </p>
      <ul className="space-y-1.5">
        {entries.map((e) => {
          const name = String(e.name);
          const n = e.payload?.[countKey(name)];
          const mean = e.payload?.[meanKey(name)];
          return (
            <li key={name}>
              <p className="flex items-center gap-1.5 text-zinc-700">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: e.color }} />
                <span className="font-medium text-zinc-900">{name}</span>
              </p>
              <p className="pl-3.5 tabular-nums text-zinc-700">
                Median {SEK.format(Number(e.value))} kr/m²
              </p>
              {mean !== undefined && (
                <p className="pl-3.5 tabular-nums text-zinc-500">
                  Medel {SEK.format(mean)} kr/m²
                </p>
              )}
              {n !== undefined && (
                <p className="pl-3.5 tabular-nums text-zinc-500">
                  {formatSales(n)}
                  {isLowSample(n) && " · få affärer"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Dot renderer: buckets with few sales are larger and hollow, the rest solid. */
function dotFor(name: string, color: string) {
  function Dot(props: { cx?: number; cy?: number; payload?: ChartRow; index?: number }) {
    const { cx, cy, payload } = props;
    if (cx === undefined || cy === undefined || Number.isNaN(cx) || Number.isNaN(cy)) {
      return <g />;
    }
    const low = isLowSample(payload?.[countKey(name)]);
    return (
      <circle
        className="recharts-dot"
        data-low-sample={low ? "true" : "false"}
        cx={cx}
        cy={cy}
        r={low ? 4 : 2.5}
        fill={low ? "#ffffff" : color}
        stroke={low ? color : "none"}
        strokeWidth={low ? 1.75 : 0}
        strokeOpacity={1}
      />
    );
  }
  return Dot;
}

export function PriceChart({
  series,
  granularity = "month",
}: {
  series: Series[];
  granularity?: Granularity;
}) {
  const { rows } = useMemo(() => buildChartData(series, granularity), [series, granularity]);
  if (rows.length === 0) {
    return (
      <div className="grid h-72 place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50">
        <p className="text-sm text-zinc-500">Ingen data ännu i valt urval.</p>
      </div>
    );
  }

  const ticks = pickTicks(
    rows.map((r) => r.t),
    MAX_X_TICKS
  );
  const accessibleName = `Prisutveckling: ${series.map((s) => s.name).join(", ")}`;
  const dataTable = <ChartDataTable title="Prisutveckling – diagramdata"
    headers={["Serie", "Period", "Median kr/m²", "Medel kr/m²", "Antal försäljningar"]}
    rows={series.flatMap((s) => s.points.map((point) => [s.name,
      formatBucketLong(new Date(`${point.bucket}T00:00:00Z`).getTime(), granularity),
      SEK.format(point.medianPricePerSqm), SEK.format(point.meanPricePerSqm),
      `${point.count}${isLowSample(point.count) ? " (få affärer)" : ""}`,
    ]))} />;
  const colorOf = (s: Series, i: number) => s.color ?? CHART_COLORS[i % CHART_COLORS.length];

  const axes = (
    <>
      <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
      <XAxis
        dataKey="t"
        type="number"
        scale="time"
        domain={["dataMin", "dataMax"]}
        ticks={ticks}
        tickFormatter={(t) => formatBucket(Number(t), granularity)}
        tick={{ fontSize: 11, fill: "#71717a" }}
        tickLine={false}
        axisLine={false}
      />
      <YAxis
        tick={{ fontSize: 11, fill: "#71717a" }}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v) => `${SEK.format(Math.round(Number(v) / 1000))}k`}
        width={56}
        domain={["auto", "auto"]}
      />
      <Tooltip
        cursor={{ stroke: "#a1a1aa", strokeDasharray: "3 3" }}
        content={<ChartTooltip granularity={granularity} />}
      />
    </>
  );

  if (series.length === 1) {
    const s = series[0];
    const color = colorOf(s, 0);
    const gradId = `g-${s.name.replace(/[^a-z0-9]/gi, "_")}`;
    return (
      <div role="group" aria-label={accessibleName}>
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer initialDimension={{ width: 200, height: 288 }}>
            <AreaChart aria-label={accessibleName} data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              {axes}
              <Area
                type="monotone"
                dataKey={s.name}
                stroke={color}
                strokeWidth={1.75}
                fill={`url(#${gradId})`}
                dot={dotFor(s.name, color)}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {dataTable}
      </div>
    );
  }

  return (
    <div role="group" aria-label={accessibleName}>
      <div className="h-72 w-full min-w-0">
        <ResponsiveContainer initialDimension={{ width: 200, height: 288 }}>
          <LineChart aria-label={accessibleName} data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            {axes}
            {/* Paint the lead series last so coincident comparison dots cannot hide it. */}
            {series.map((s, i) => ({ s, i })).reverse().map(({ s, i }) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={colorOf(s, i)}
                strokeWidth={2}
                dot={dotFor(s.name, colorOf(s, i))}
                activeDot={{ r: 5 }}
                connectNulls={false}
                />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div role="list" aria-label="Diagramförklaring" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s, i) => (
          <div role="listitem" key={s.name} className="flex items-center gap-1.5 text-zinc-700">
            <span
              className="h-2 w-3 rounded-full"
              style={{ background: colorOf(s, i) }}
              aria-hidden
            />
            {s.name}
          </div>
        ))}
      </div>
      {dataTable}
    </div>
  );
}
