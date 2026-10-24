import type { AddressResponse } from "@/lib/api-types";

/** Place SQL buckets and individual sales on the same UTC time axis. */
export function drawerSeries(data: AddressResponse | null) {
  const trendRows: { t: number; trend: number | null; count: number }[] = [];
  const buckets = [...(data?.streetSeries ?? [])].sort((a, b) => a.bucket.localeCompare(b.bucket));
  for (const bucket of buckets) {
    const t = Date.parse(bucket.bucket);
    const previous = trendRows.at(-1);
    if (previous) {
      const next = new Date(previous.t);
      if (data?.granularity === "month") next.setUTCMonth(next.getUTCMonth() + 1);
      else next.setUTCDate(next.getUTCDate() + (data?.granularity === "week" ? 7 : 1));
      // One null is enough to break the line across any number of missing buckets.
      if (next.getTime() < t) trendRows.push({ t: next.getTime(), trend: null, count: 0 });
    }
    trendRows.push({ t, trend: bucket.medianPricePerSqm, count: bucket.count });
  }
  // Separate series keep address dates from creating holes in the street curve,
  // and preserve multiple observations on the same date.
  const saleRows = (data?.addressSales ?? []).map((sale) => ({
    t: Date.parse(sale.soldAt), sale: sale.pricePerSqmSek,
  }));
  // Recharts concatenates per-series domains; sort their union so its tick
  // collision algorithm sees chronological positions instead of series order.
  const ticks = [...new Set([...trendRows, ...saleRows].map((point) => point.t))].sort((a, b) => a - b);
  return { trendRows, saleRows, ticks };
}
