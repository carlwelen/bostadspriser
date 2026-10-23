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

import type { Granularity } from "@/lib/aggregations";

export type Series = {
  name: string;
  color?: string;
  points: Array<{ bucket: string; meanPricePerSqm: number; count: number }>;
};

// Multi-series palette tuned to feel data-forward, not playful.
// Lead with the brand accent; subsequent series use desaturated companions.
const PALETTE = ["#1d4ed8", "#0f172a", "#0d9488", "#b45309", "#9f1239"];
const SEK = new Intl.NumberFormat("sv-SE");

function mergePoints(series: Series[]) {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byBucket.get(p.bucket) ?? { bucket: p.bucket };
      row[s.name] = p.meanPricePerSqm;
      byBucket.set(p.bucket, row);
    }
  }
  return [...byBucket.values()].sort((a, b) =>
    String(a.bucket).localeCompare(String(b.bucket))
  );
}

export function formatBucket(b: string, granularity: Granularity = "month") {
  // Monthly: 2026-04-01 → "apr 26". Yearly: 2025-01-01 → "2025".
  const d = new Date(b);
  if (Number.isNaN(d.getTime())) return b;
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  if (granularity === "year") return String(year);
  const monthLabel = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"][month];
  return `${monthLabel} ${String(year).slice(2)}`;
}

export function PriceChart({
  series,
  granularity = "month",
}: {
  series: Series[];
  granularity?: Granularity;
}) {
  const data = mergePoints(series);
  if (data.length === 0) {
    return (
      <div className="grid h-72 place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50">
        <p className="text-sm text-zinc-500">Ingen data ännu i valt urval.</p>
      </div>
    );
  }

  const isSingle = series.length === 1;

  if (isSingle) {
    const s = series[0];
    const color = s.color ?? PALETTE[0];
    const gradId = `g-${s.name.replace(/[^a-z0-9]/gi, "_")}`;
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
            <XAxis
              dataKey="bucket"
              tickFormatter={(b) => formatBucket(String(b), granularity)}
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
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: "1px solid #e4e4e7",
                boxShadow: "0 4px 16px rgb(0 0 0 / 0.04)",
              }}
              formatter={(value) => [`${SEK.format(Number(value))} kr/m²`, "Medel"]}
              labelFormatter={(label) => formatBucket(String(label), granularity)}
            />
            <Area
              type="monotone"
              dataKey={s.name}
              stroke={color}
              strokeWidth={1.75}
              fill={`url(#${gradId})`}
              dot={{ r: 2.5, strokeWidth: 0, fill: color }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
          <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
          <XAxis
            dataKey="bucket"
            tickFormatter={(b) => formatBucket(String(b), granularity)}
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
            contentStyle={{
              fontSize: 12,
              borderRadius: 10,
              border: "1px solid #e4e4e7",
              boxShadow: "0 4px 16px rgb(0 0 0 / 0.04)",
            }}
            formatter={(value) => [`${SEK.format(Number(value))} kr/m²`, undefined]}
            labelFormatter={(label) => formatBucket(String(label), granularity)}
          />
          {series.map((s, i) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color ?? PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: s.color ?? PALETTE[i % PALETTE.length] }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s, i) => (
          <div key={s.name} className="flex items-center gap-1.5 text-zinc-700">
            <span
              className="h-2 w-3 rounded-full"
              style={{ background: s.color ?? PALETTE[i % PALETTE.length] }}
              aria-hidden
            />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}
