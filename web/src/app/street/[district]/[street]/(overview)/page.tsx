import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { formatSales, formatSold } from "@/components/plural";
import { PriceChart } from "@/components/PriceChart";
import { RecentSalesTable } from "@/components/RecentSalesTable";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StatCard } from "@/components/StatCard";
import { SummaryCards } from "@/components/SummaryCards";
import {
  listHouseNumbers,
  recentSales,
  streetSummary,
  streetTimeseries,
} from "@/lib/aggregations";
import { districtName } from "@/lib/districts";
import { resolveStreet } from "../../../resolveStreet";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ district: string; street: string }>;
}): Promise<Metadata> {
  const { district: districtParam, street: streetSlug } = await params;
  const resolved = await resolveStreet(districtParam, streetSlug);
  if (!resolved) return {};
  const { district, street } = resolved;
  return {
    title: `${street}, ${districtName(district)} — bostadspriser`,
    description: `Slutpriser för ${street} i ${districtName(district)}.`,
  };
}

const SEK = new Intl.NumberFormat("sv-SE");

export default async function StreetPage({
  params,
}: {
  params: Promise<{ district: string; street: string }>;
}) {
  const { district: districtParam, street: streetSlug } = await params;
  const resolved = await resolveStreet(districtParam, streetSlug);
  if (!resolved) notFound();
  const { district, street } = resolved;

  const [points, summary, houses, sales] = await Promise.all([
    streetTimeseries(district, street, "month"),
    streetSummary(district, street),
    listHouseNumbers(district, street),
    recentSales({ district, street }, 50),
  ]);

  return (
    <>
      <SiteHeader
        crumbs={[
          { label: districtName(district), href: `/district/${district}` },
          { label: street },
        ]}
      />
      <PageHero
        kicker="Gata"
        title={street}
        accent={street}
        subtitle={`${districtName(district)}, Stockholms innerstad`}
      />
      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
        <SummaryCards
          summary={summary}
          extra={
            <StatCard
              label="Husnummer i underlaget"
              value={houses.length}
              hint={
                houses.length > 0
                  ? `${houses.slice(0, 4).map((h) => h.houseNumber).join(", ")}${
                      houses.length > 4 ? ", …" : ""
                    }`
                  : undefined
              }
            />
          }
        />

        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between">
            <h2 className="text-base font-medium text-zinc-900">
              Pris/m² över tid
            </h2>
            <p className="text-xs text-zinc-500">Månadsmedel</p>
          </div>
          <PriceChart series={[{ name: street, points }]} />
        </section>

        {houses.length > 0 && (
          <section>
            <h2 className="mb-3 text-base font-medium text-zinc-900">Husnummer</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {houses.map((h) => (
                <li key={h.houseNumber}>
                  <Link
                    href={`/street/${district}/${streetSlug}/${encodeURIComponent(h.houseNumber)}`}
                    className="block rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-zinc-300 hover:shadow-sm"
                  >
                    <p className="text-sm font-medium text-zinc-900">
                      {street} {h.houseNumber}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {formatSold(h.count)} • {SEK.format(h.meanPricePerSqm)} kr/m²
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-1 text-base font-medium text-zinc-900">Senaste försäljningar</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Visar {sales.length} av {formatSales(summary.count)}.
          </p>
          <RecentSalesTable sales={sales} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
