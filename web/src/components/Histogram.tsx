"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartDataTable } from "./ChartDataTable";
import { CHART_THEME } from "./chartColors";
import { formatSold } from "./plural";

const SEK = new Intl.NumberFormat("sv-SE");

export function Histogram({
  data,
  bucketWidth,
}: {
  data: Array<{ bucket: number; count: number }>;
  bucketWidth: number;
}) {
  if (data.length === 0) {
    return (
      <div className="grid h-72 place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50">
        <p className="text-sm text-zinc-500">Inga försäljningar i underlaget.</p>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Prisfördelning per kvadratmeter">
      <div className="h-72 w-full min-w-0">
        <ResponsiveContainer initialDimension={{ width: 200, height: 288 }}>
          <BarChart aria-label="Prisfördelning per kvadratmeter" data={data} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            <CartesianGrid stroke={CHART_THEME.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 11, fill: CHART_THEME.axis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${SEK.format(Math.round(Number(v) / 1000))}k`}
            />
            <YAxis
              tick={{ fontSize: 11, fill: CHART_THEME.axis }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "rgba(63, 63, 70, 0.05)" }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: `1px solid ${CHART_THEME.grid}`,
              }}
              formatter={(v) => [formatSold(Number(v)), "Antal"]}
              labelFormatter={(label) => {
                const start = Number(label);
                return `${SEK.format(start)}–${SEK.format(start + bucketWidth - 1)} kr/m²`;
              }}
            />
            <Bar dataKey="count" fill={CHART_THEME.primary} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable title="Prisfördelning – diagramdata" headers={["Prisintervall", "Antal försäljningar"]}
        rows={data.map((point) => [`${SEK.format(point.bucket)}–${SEK.format(point.bucket + bucketWidth - 1)} kr/m²`, point.count])} />
    </div>
  );
}
