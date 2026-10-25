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

import { districtColor, districtName, isDistrictSlug } from "@/lib/districts";
import { CHART_THEME } from "./chartColors";
import { ChartDataTable } from "./ChartDataTable";

const SEK = new Intl.NumberFormat("sv-SE");

const labelOf = (district: string) => isDistrictSlug(district) ? districtName(district) : district;
const colorOf = (district: string) => isDistrictSlug(district) ? districtColor(district) : CHART_THEME.axis;

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
    <div role="group" aria-label="Yta och pris per kvadratmeter per stadsdel" className="space-y-3">
      <div className="h-80 w-full min-w-0">
        <ResponsiveContainer initialDimension={{ width: 200, height: 320 }}>
          <ScatterChart aria-label="Yta och pris per kvadratmeter per stadsdel" margin={{ top: 8, right: 16, bottom: 16, left: 4 }}>
            <CartesianGrid stroke={CHART_THEME.grid} strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="areaSqm"
              name="Yta"
              unit=" m²"
              tick={{ fontSize: 11, fill: CHART_THEME.axis }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              dataKey="pricePerSqm"
              name="Pris/m²"
              tick={{ fontSize: 11, fill: CHART_THEME.axis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${SEK.format(Math.round(Number(v) / 1000))}k`}
              width={56}
            />
            <ZAxis range={[20, 20]} />
            <Tooltip
              cursor={{ stroke: CHART_THEME.cursor, strokeDasharray: "3 3" }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: `1px solid ${CHART_THEME.grid}`,
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
                name={labelOf(district)}
                data={pts}
                fill={colorOf(district)}
                fillOpacity={0.55}
                stroke={colorOf(district)}
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
              style={{ background: colorOf(district) }}
              aria-hidden
            />
            {labelOf(district)}
          </div>
        ))}
      </div>
      <ChartDataTable title="Yta och pris – diagramdata" headers={["Stadsdel", "Yta m²", "Pris kr/m²", "Rum"]}
        rows={data.map((point) => [labelOf(point.district), SEK.format(point.areaSqm), SEK.format(point.pricePerSqm), point.rooms ?? "—"])} />
    </div>
  );
}
