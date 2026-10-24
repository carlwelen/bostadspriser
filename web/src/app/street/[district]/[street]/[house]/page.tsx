import { notFound } from "next/navigation";
import { GranularityToggle } from "@/components/GranularityToggle";
import { granularityCaption, parseGranularity } from "@/components/granularity";
import { PageHero } from "@/components/PageHero";
import { PriceChart } from "@/components/PriceChart";
import { RecentSalesTable } from "@/components/RecentSalesTable";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { formatSales } from "@/components/plural";
import { StatCard } from "@/components/StatCard";
import { SummaryCards } from "@/components/SummaryCards";
import {
  addressSummary,
  districtTimeseries,
  recentSales,
  streetTimeseries,
} from "@/lib/aggregations";
import { districtName } from "@/lib/districts";
import { resolveStreet } from "../../../resolveStreet";

export const dynamic = "force-dynamic";

export default async function AddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ district: string; street: string; house: string }>;
  searchParams: Promise<{ g?: string | string[] }>;
}) {
  const { district: districtParam, street: streetSlug, house } = await params;
  const granularity = parseGranularity((await searchParams).g);
  const resolved = await resolveStreet(districtParam, streetSlug);
  if (!resolved) notFound();
  const { district, street } = resolved;
  const houseNumber = decodeURIComponent(house);

  const [districtPoints, streetPoints, addressPoints, summary, sales] = await Promise.all([
    districtTimeseries(district, granularity),
    streetTimeseries(district, street, granularity),
    streetTimeseries(district, street, granularity, houseNumber),
    addressSummary(district, street, houseNumber),
    recentSales({ district, street, houseNumber }, 50),
  ]);

  if (addressPoints.length === 0 && sales.length === 0) notFound();

  return (
    <>
      <SiteHeader
        crumbs={[
          { label: districtName(district), href: `/district/${district}` },
          { label: street, href: `/street/${district}/${streetSlug}` },
          { label: houseNumber },
        ]}
      />
      <PageHero
        kicker="Adress"
        title={`${street} ${houseNumber}`}
        accent={houseNumber}
        subtitle={`${districtName(district)}, Stockholms innerstad`}
      />
      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
        <SummaryCards summary={summary} extra={<StatCard label="Gata" value={street} />} />

        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-zinc-900">
                Pris/m² över tid
              </h2>
              <p className="text-xs text-zinc-500">
                {granularityCaption(granularity)} — adress vs gata vs stadsdel
              </p>
            </div>
            <GranularityToggle
              granularity={granularity}
              path={`/street/${district}/${streetSlug}/${encodeURIComponent(houseNumber)}`}
            />
          </div>
          <PriceChart
            series={[
              { name: `${street} ${houseNumber}`, points: addressPoints, color: "#2563eb" },
              { name: `${street} (gata)`, points: streetPoints, color: "#a1a1aa" },
              { name: `${districtName(district)} (stadsdel)`, points: districtPoints, color: "#0f172a" },
            ]}
            granularity={granularity}
          />
        </section>

        <section>
          <h2 className="mb-1 text-base font-medium text-zinc-900">Försäljningar</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Visar {sales.length} av {formatSales(summary.count)}.
          </p>
          <RecentSalesTable sales={sales} showStreet={false} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
