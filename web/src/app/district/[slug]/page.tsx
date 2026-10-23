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
import {
  districtMomChange,
  districtSummary,
  districtTimeseries,
  listStreets,
  recentSales,
} from "@/lib/aggregations";
import { districtName, isDistrictSlug } from "@/lib/districts";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isDistrictSlug(slug)) return {};
  const name = districtName(slug);
  return {
    title: `${name} — bostadspriser`,
    description: `Slutpriser och prisutveckling för ${name} i Stockholms innerstad.`,
  };
}

const SEK = new Intl.NumberFormat("sv-SE");
const PCT = new Intl.NumberFormat("sv-SE", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

export default async function DistrictPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isDistrictSlug(slug)) notFound();

  const [points, summary, mom, topStreets, sales] = await Promise.all([
    districtTimeseries(slug, "month"),
    districtSummary(slug),
    districtMomChange(slug),
    listStreets(slug, 12),
    recentSales({ district: slug }, 25),
  ]);

  const meanPps = summary.meanPricePerSqm;

  const tone = mom?.pctChange == null ? "neutral" : mom.pctChange >= 0 ? "up" : "down";

  return (
    <>
      <SiteHeader crumbs={[{ label: districtName(slug) }]} />
      <PageHero
        kicker="Stadsdel"
        title={districtName(slug)}
        accent={districtName(slug)}
        subtitle={
          <>
            <span className="tabular-nums">
              {summary.earliest ?? "—"}
              {" → "}
              {summary.latest ?? "—"}
            </span>
            <span className="mx-2 text-zinc-500">·</span>
            <span>{formatSales(summary.count)} i underlaget</span>
          </>
        }
      />
      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Försäljningar" value={SEK.format(summary.count)} />
          <StatCard
            label="Medel pris/m²"
            value={meanPps ? `${SEK.format(Math.round(meanPps))} kr` : "—"}
          />
          <StatCard
            label="MoM"
            value={
              mom?.pctChange == null ? "—" : PCT.format(mom.pctChange / 100)
            }
            hint={
              mom?.current && mom?.previous
                ? `${SEK.format(mom.previous)} → ${SEK.format(mom.current)}`
                : undefined
            }
            tone={tone as "neutral" | "up" | "down"}
          />
          <StatCard
            label="Antal gator"
            value={topStreets.length >= 12 ? "12+" : topStreets.length}
          />
        </section>

        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-zinc-900">
                Pris/m² över tid
              </h2>
              <p className="text-xs text-zinc-500">Månadsmedel</p>
            </div>
            <Link
              href={`/compare?series=district:${slug}`}
              className="text-sm text-zinc-500 hover:text-zinc-900"
            >
              Jämför →
            </Link>
          </div>
          <PriceChart series={[{ name: districtName(slug), points }]} />
        </section>

        {topStreets.length > 0 && (
          <section>
            <div className="mb-3 flex items-end justify-between">
              <h2 className="text-base font-medium text-zinc-900">Mest aktiva gator</h2>
              <p className="text-xs text-zinc-500">Topp 12 efter antal sålda</p>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {topStreets.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/street/${slug}/${s.slug}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-300 hover:shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{s.street}</p>
                      <p className="text-xs text-zinc-500">
                        {formatSold(s.count)} • senast {s.latestSoldAt}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-700">
                      {SEK.format(s.meanPricePerSqm)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-base font-medium text-zinc-900">
            Senaste försäljningar
          </h2>
          <RecentSalesTable sales={sales} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
