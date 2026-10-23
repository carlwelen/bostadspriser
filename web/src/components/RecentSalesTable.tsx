import type { RecentSale } from "@/lib/aggregations";
import { SourceBadge } from "./SourceBadge";

const SEK = new Intl.NumberFormat("sv-SE");

export function RecentSalesTable({
  sales,
  showStreet = true,
}: {
  sales: RecentSale[];
  showStreet?: boolean;
}) {
  if (sales.length === 0) {
    return <p className="text-sm text-zinc-500">Inga försäljningar ännu.</p>;
  }
  return (
    // The wrapper scrolls sideways on narrow screens; the columns keep their width.
    <div
      role="region"
      aria-label="Försäljningar (scrolla i sidled)"
      tabIndex={0}
      className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-medium">Datum</th>
            {showStreet && <th className="px-4 py-3 font-medium">Adress</th>}
            <th className="px-4 py-3 font-medium">Rum</th>
            <th className="px-4 py-3 font-medium">Yta</th>
            <th className="px-4 py-3 text-right font-medium">Pris</th>
            <th className="px-4 py-3 text-right font-medium">Pris/m²</th>
            <th className="px-4 py-3 font-medium">Källa</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {sales.map((s, i) => (
            <tr key={`${s.street}-${s.houseNumber ?? "_"}-${s.soldAt}-${i}`} className="hover:bg-zinc-50">
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-zinc-600">
                {s.soldAt}
              </td>
              {showStreet && (
                <td className="px-4 py-2.5 text-zinc-900">
                  {s.street}
                  {s.houseNumber ? ` ${s.houseNumber}` : ""}
                </td>
              )}
              <td className="px-4 py-2.5 tabular-nums text-zinc-700">
                {s.rooms ?? "–"}
              </td>
              <td className="px-4 py-2.5 tabular-nums text-zinc-700">
                {s.areaSqm ? `${s.areaSqm} m²` : "–"}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-zinc-900">
                {SEK.format(s.priceSek)} kr
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                {SEK.format(s.pricePerSqmSek)} kr
              </td>
              <td className="px-4 py-2.5">
                <SourceBadge sources={s.sources} size="xs" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
