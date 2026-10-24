"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

const SEK = new Intl.NumberFormat("sv-SE");

// Color-blind-aware, data-forward palette. One accent + three calm companions.
const DISTRICT_COLORS: Record<string, string> = {
  ostermalm: "#1d4ed8",
  vasastan: "#0f172a",
  norrmalm: "#0d9488",
  sodermalm: "#b45309",
};

const DISTRICT_LABELS: Record<string, string> = {
  ostermalm: "Östermalm",
  vasastan: "Vasastan",
  norrmalm: "Norrmalm",
  sodermalm: "Södermalm",
};

type Point = {
  areaSqm: number;
  pricePerSqm: number;
  rooms: number | null;
  district: string;
};

export function PriceAreaScatter({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="grid h-80 place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50">
        <p className="text-sm text-zinc-500">Inga försäljningar i underlaget.</p>
      </div>
    );
  }

  // Group by district so each gets its own color in the legend.
  const byDistrict = new Map<string, Point[]>();
  for (const p of data) {
    const arr = byDistrict.get(p.district) ?? [];
    arr.push(p);
    byDistrict.set(p.district, arr);
  }

  return (
    <div className="space-y-3">
      <div className="h-80 w-full min-w-0">
        <ResponsiveContainer initialDimension={{ width: 200, height: 320 }}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 4 }}>
            <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="areaSqm"
              name="Yta"
              unit=" m²"
              tick={{ fontSize: 11, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              dataKey="pricePerSqm"
              name="Pris/m²"
              tick={{ fontSize: 11, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${SEK.format(Math.round(Number(v) / 1000))}k`}
              width={56}
            />
            <ZAxis range={[20, 20]} />
            <Tooltip
              cursor={{ stroke: "#a1a1aa", strokeDasharray: "3 3" }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: "1px solid #e4e4e7",
              }}
              formatter={(value, name) => {
                if (name === "Yta") return [`${value} m²`, name];
                if (name === "Pris/m²") return [`${SEK.format(Number(value))} kr/m²`, name];
                return [String(value), String(name)];
              }}
            />
            {[...byDistrict.entries()].map(([district, pts]) => (
              <Scatter
                key={district}
                name={DISTRICT_LABELS[district] ?? district}
                data={pts}
                fill={DISTRICT_COLORS[district] ?? "#71717a"}
                fillOpacity={0.55}
                stroke="white"
                strokeWidth={1}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {[...byDistrict.keys()].map((district) => (
          <div key={district} className="flex items-center gap-1.5 text-zinc-700">
            <span
              className="h-2 w-3 rounded-full"
              style={{ background: DISTRICT_COLORS[district] ?? "#71717a" }}
              aria-hidden
            />
            {DISTRICT_LABELS[district] ?? district}
          </div>
        ))}
      </div>
    </div>
  );
}
