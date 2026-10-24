import type { Metadata } from "next";
import { pageMetadata } from "../../siteMetadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { comparisonHref } from "@/components/comparison";
import { GranularityToggle } from "@/components/GranularityToggle";
import { granularityCaption, parseGranularity } from "@/components/granularity";
import { PageHero } from "@/components/PageHero";
import { formatSales, formatSold } from "@/components/plural";
import { PriceChart } from "@/components/PriceChart";
import { RecentSalesTable } from "@/components/RecentSalesTable";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StatCard } from "@/components/StatCard";
import { RoomChips } from "@/components/RoomChips";
import { parseRooms, roomsHref } from "@/components/rooms";
import { SummaryCards } from "@/components/SummaryCards";
import {
  MIN_MOM_SALES,
  districtMomChange,
  districtStreetCount,
  districtTimeseries,
  listStreets,
  recentSales,
} from "@/lib/aggregations";
import { districtColor, districtName, isDistrictSlug } from "@/lib/districts";
import { describeMom } from "./mom";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isDistrictSlug(slug)) return {};
  const name = districtName(slug);
  return pageMetadata(`${name} — bostadspriser`, `Slutpriser och prisutveckling för ${name} i Stockholms innerstad.`, `/district/${slug}`);
}

const SEK = new Intl.NumberFormat("sv-SE");
export default async function DistrictPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ g?: string | string[]; rooms?: string | string[] }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const granularity = parseGranularity(sp.g);
  const rooms = parseRooms(sp.rooms);
  if (!isDistrictSlug(slug)) notFound();

  const [points, summary, mom, topStreets, sales] = await Promise.all([
    districtTimeseries(slug, granularity, rooms),
    districtStreetCount(slug, rooms),
    districtMomChange(slug, undefined, rooms),
    listStreets(slug, 12, rooms),
    recentSales({ district: slug, rooms }, 25),
  ]);

  const momCard = describeMom(mom, MIN_MOM_SALES);

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
        <RoomChips path={`/district/${slug}`} params={sp} rooms={rooms} />
        <SummaryCards
          summary={summary}
          extra={
            <>
              <StatCard label="Antal gator" value={SEK.format(summary.streetCount)} />
              <StatCard
                label="Förändring mot föregående månad"
                value={momCard.value}
                hint={momCard.hint}
                tone={momCard.tone}
              />
            </>
          }
        />

        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-zinc-900">
                Pris/m² över tid
              </h2>
              <p className="text-xs text-zinc-500">{granularityCaption(granularity)}</p>
            </div>
            <div className="flex items-center gap-3">
              <GranularityToggle granularity={granularity} path={`/district/${slug}`} params={sp} />
              <Link
                href={comparisonHref([`district:${slug}`], granularity)}
                className="text-sm text-zinc-500 hover:text-zinc-900"
              >
                Jämför →
              </Link>
            </div>
          </div>
          <PriceChart series={[{ name: districtName(slug), points, color: districtColor(slug) }]} granularity={granularity} />
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
                    href={roomsHref(`/street/${slug}/${s.slug}`, sp, rooms)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-300 hover:shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{s.street}</p>
                      <p className="text-xs text-zinc-500">
                        {formatSold(s.count)} • senast {s.latestSoldAt}
                      </p>
                    </div>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-medium tabular-nums text-zinc-900">
                        {SEK.format(s.medianPricePerSqm)}
                        <span className="ml-1 text-[11px] font-normal text-zinc-500">median</span>
                      </span>
                      <span className="block text-[11px] tabular-nums text-zinc-500">
                        medel {SEK.format(s.meanPricePerSqm)} kr/m²
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-1 text-base font-medium text-zinc-900">
            Senaste försäljningar
          </h2>
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
