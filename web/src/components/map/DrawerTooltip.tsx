import type { AddressResponse } from "@/lib/api-types";
import { CHART_THEME } from "../chartColors";
import { formatSales } from "../plural";

const SEK = new Intl.NumberFormat("sv-SE");

export function StreetDot({ cx, cy, payload }: {
  cx?: number; cy?: number; payload?: { trend: number | null; count: number };
}) {
  if (cx == null || cy == null || payload?.trend == null) return <g />;
  const sparse = payload.count < 3;
  return <circle cx={cx} cy={cy} r={sparse ? 4 : 2.5} fill={sparse ? CHART_THEME.surface : CHART_THEME.primary}
    stroke={CHART_THEME.primary} strokeWidth={sparse ? 2 : 1} aria-label={formatSales(payload.count)} />;
}

export function DrawerTooltip({ active, label, data }: {
  active?: boolean; label?: string | number; data: AddressResponse | null;
}) {
  const t = Number(label);
  if (!active || !data || label == null || !Number.isFinite(t)) return null;
  const date = new Date(t).toISOString().slice(0, 10);
  const street = data.streetSeries.find((point) => point.bucket === date);
  const sales = data.addressSales.filter((sale) => sale.soldAt === date);
  if (!street && sales.length === 0) return null;
  return (
    <div role="tooltip" tabIndex={0} aria-label={`Försäljningar ${date}`}
      style={{ pointerEvents: sales.length > 2 ? "auto" : undefined }}
      onMouseMove={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation(); }}
      className="max-h-[min(192px,40dvh)] overflow-y-auto overscroll-contain focus:outline-2 focus:outline-blue-700 max-w-[min(260px,70vw)] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 shadow-sm">
      <p className="font-medium text-zinc-900">{date}</p>
      {street && <div className="mt-2">
        <p>Gatans median: {SEK.format(street.medianPricePerSqm)} kr/m²</p>
        <p>Medel: {SEK.format(street.meanPricePerSqm)} kr/m²</p>
        <p>{formatSales(street.count)}{street.count < 3 && " · få affärer"}</p>
      </div>}
      {sales.map((sale, index) => <div key={index} className="mt-2">
        <p>Försäljning: {SEK.format(sale.pricePerSqmSek)} kr/m²</p>
        <p>{formatSales(1)}</p>
      </div>)}
    </div>
  );
}
