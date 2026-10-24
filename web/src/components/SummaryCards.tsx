import type { ReactNode } from "react";
import type { SalesSummary } from "@/lib/aggregations";
import { StatCard } from "./StatCard";

const SEK = new Intl.NumberFormat("sv-SE");

const kr = (v: number | null) => (v == null ? "—" : `${SEK.format(v)} kr`);

/**
 * The headline cards shared by the district, street and address pages: sale
 * count, median and mean kr/m² and the sold-date span, all over every sale in
 * the scope (the SQL summaries), not just the rows listed below them.
 * `extra` appends page-specific cards.
 */
export function SummaryCards({
  summary,
  extra,
}: {
  summary: SalesSummary;
  extra?: ReactNode;
}) {
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard label="Försäljningar" value={SEK.format(summary.count)} />
      <StatCard
        label="Median pris/m²"
        value={kr(summary.medianPricePerSqm)}
        hint="Mittenvärdet, påverkas inte av enstaka extremaffärer"
      />
      <StatCard label="Medelpris/m²" value={kr(summary.meanPricePerSqm)} />
      <StatCard
        label="Tidsspann"
        value={
          <span className="text-lg leading-tight">
            {summary.earliest ?? "—"} → {summary.latest ?? "—"}
          </span>
        }
        hint="Första och senaste försäljningsdatum"
      />
      {extra}
    </section>
  );
}
