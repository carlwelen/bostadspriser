import { notFound } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { PriceChart } from "@/components/PriceChart";
import { RecentSalesTable } from "@/components/RecentSalesTable";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StatCard } from "@/components/StatCard";
import {
  recentSales,
  streetFromSlug,
  streetTimeseries,
} from "@/lib/aggregations";
import { districtName, isDistrictSlug } from "@/lib/districts";

export const dynamic = "force-dynamic";

const SEK = new Intl.NumberFormat("sv-SE");

export default async function AddressPage({
  params,
}: {
  params: Promise<{ district: string; street: string; house: string }>;
}) {
  const { district, street: streetSlug, house } = await params;
  if (!isDistrictSlug(district)) notFound();

  const street = await streetFromSlug(district, streetSlug);
  if (!street) notFound();
  const houseNumber = decodeURIComponent(house);

  const [streetPoints, addressPoints, sales] = await Promise.all([
    streetTimeseries(district, street, "month"),
    streetTimeseries(district, street, "month", houseNumber),
    recentSales({ district, street, houseNumber }, 50),
  ]);

  if (addressPoints.length === 0 && sales.length === 0) notFound();

  const meanPps =
    sales.length > 0
      ? Math.round(
          sales.reduce((s, x) => s + x.pricePerSqmSek, 0) / sales.length
        )
      : null;

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
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Försäljningar" value={sales.length} />
          <StatCard
            label="Medel pris/m²"
            value={meanPps ? `${SEK.format(meanPps)} kr` : "—"}
          />
          <StatCard label="Gata" value={street} />
        </section>

        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between">
            <h2 className="text-base font-medium text-zinc-900">
              Pris/m² över tid
            </h2>
            <p className="text-xs text-zinc-500">Månadsmedel — adress vs gata</p>
          </div>
          <PriceChart
            series={[
              { name: `${street} ${houseNumber}`, points: addressPoints, color: "#2563eb" },
              { name: `${street} (gata)`, points: streetPoints, color: "#a1a1aa" },
            ]}
          />
        </section>

        <section>
          <h2 className="mb-3 text-base font-medium text-zinc-900">Försäljningar</h2>
          <RecentSalesTable sales={sales} showStreet={false} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
