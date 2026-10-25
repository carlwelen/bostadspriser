import Link from "next/link";
import { pageMetadata } from "../siteMetadata";

import { formatUpdated, latestUpdate, partialRuns, sourceLabel } from "@/components/freshness";
import { Histogram } from "@/components/Histogram";
import { PageHero } from "@/components/PageHero";
import { formatSales } from "@/components/plural";
import { PriceAreaScatter } from "@/components/PriceAreaScatter";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StatCard } from "@/components/StatCard";
import {
  globalSummary,
  latestScrapeRuns,
  pricePerSqmDistribution,
  priceAreaSample,
  roomsBreakdown,
  sourceFreshness,
  topMovers,
} from "@/lib/aggregations";
import { districtName } from "@/lib/districts";

export const dynamic = "force-dynamic";

const BUCKET_WIDTH = 20_000;
const SEK = new Intl.NumberFormat("sv-SE");
const PCT = new Intl.NumberFormat("sv-SE", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

export const metadata = pageMetadata(
  "Insikter — bostadspriser",
  "Aggregerade mönster i Stockholms innerstad: prisfördelning, rumssegment och gator som rört sig mest.",
  "/insights"
);

export default async function InsightsPage() {
  const [summary, distribution, rooms, scatter, moversUp, moversDown, sources, runs] =
    await Promise.all([
      globalSummary(),
      pricePerSqmDistribution(BUCKET_WIDTH),
      roomsBreakdown(),
      priceAreaSample(800),
      topMovers("up", 6),
      topMovers("down", 6),
      sourceFreshness(),
      latestScrapeRuns(),
    ]);
  const updated = latestUpdate(sources);
  const partial = partialRuns(runs);

  return (
    <>
      <SiteHeader crumbs={[{ label: "Insikter" }]} />
      <PageHero
        kicker="Insikter"
        title="Mönster i Stockholms innerstad"
        accent="Stockholms innerstad"
        subtitle={
          <>
            <p>
              {summary.earliest && summary.latest
                ? `Slutpriser i Stockholms innerstad från ${summary.earliest} till ${summary.latest}, sammanställda från Hemnet och Booli. Där det går visas median, eftersom enstaka mycket dyra affärer annars drar upp snittet.`
                : "Underlaget laddas in löpande från Hemnet och Booli."}
            </p>
            <p className="mt-2 text-zinc-400">
              {updated
                ? `Senast uppdaterad ${formatUpdated(updated)}.`
                : "Ingen uppdatering har registrerats ännu."}
            </p>
          </>
        }
      />
      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">


        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Försäljningar" value={SEK.format(summary.total)} />
          <StatCard
            label="Median pris/m²"
            value={summary.medianPricePerSqm
              ? `${SEK.format(summary.medianPricePerSqm)} kr`
              : "—"}
          />
          <StatCard
            label="Medelpris/m²"
            value={summary.meanPricePerSqm
              ? `${SEK.format(summary.meanPricePerSqm)} kr`
              : "—"}
          />
          <StatCard label="Stadsdelar i urvalet" value={summary.byDistrict.length} />
          <StatCard
            label="Tidsspann"
            value={
              summary.earliest && summary.latest
                ? `${summary.earliest.slice(0, 7)} → ${summary.latest.slice(0, 7)}`
                : "—"
            }
          />
        </section>

        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-base font-medium text-zinc-900">
                Prisfördelning per kvadratmeter
              </h2>
              <p className="text-xs text-zinc-500">
                Antal försäljningar per {SEK.format(BUCKET_WIDTH)} kr-intervall
              </p>
            </div>
          </div>
          <Histogram data={distribution} bucketWidth={BUCKET_WIDTH} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Movers title="Stigande gator" subtitle="Median senaste 90 dagar jämfört med föregående 12 månader" entries={moversUp} />
          <Movers title="Fallande gator" subtitle="Median senaste 90 dagar jämfört med föregående 12 månader" entries={moversDown} />
        </section>

        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-base font-medium text-zinc-900">
                Yta vs pris/m² per stadsdel
              </h2>
              <p className="text-xs text-zinc-500">
                Slumpmässigt urval om upp till 800 lägenheter
              </p>
            </div>
          </div>
          <PriceAreaScatter data={scatter} />
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-base font-medium text-zinc-900">Rumssegment</h2>
            <p className="text-xs text-zinc-500">
              Median och medelvärden grupperade efter antal rum
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <caption className="sr-only">Försäljningar per antal rum</caption>
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Rum</th>
                  <th scope="col" className="px-4 py-3 font-medium">Antal</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Medel yta</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Medel pris</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Median pris/m²</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Medel pris/m²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rooms.length === 0 ? (
                  <tr>
                    <td colSpan={6}className="px-4 py-6 text-sm text-zinc-500">
                      Inga försäljningar i underlaget ännu.
                    </td>
                  </tr>
                ) : (
                  rooms.map((r) => (
                    <tr key={r.rooms} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5 font-medium text-zinc-900">
                        {r.rooms === 7 ? "7+" : r.rooms}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-700">{r.count}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                        {Math.round(r.meanAreaSqm)} m²
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                        {SEK.format(r.meanPriceSek)} kr
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-zinc-900">
                        {SEK.format(r.medianPricePerSqm)} kr
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                        {SEK.format(r.meanPricePerSqm)} kr
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-base font-medium text-zinc-900">Datakällor</h2>
            <p className="text-xs text-zinc-500">
              När varje källa senast hämtades och vilka försäljningsdatum den täcker. Antalet är
              råa rader, så samma affär kan räknas av båda källorna.
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">Datakällornas uppdatering och täckning</caption>
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Källa</th>
                  <th scope="col" className="px-4 py-3 font-medium">Senast uppdaterad</th>
                  <th scope="col" className="px-4 py-3 font-medium">Försäljningsdatum</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Rader</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sources.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-sm text-zinc-500">
                      Inga källor har hämtats ännu.
                    </td>
                  </tr>
                ) : (
                  sources.map((src) => (
                    <tr key={src.source}>
                      <td className="px-4 py-2.5 font-medium text-zinc-900">
                        {sourceLabel(src.source)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-700">
                        {src.lastSuccessAt ? formatUpdated(src.lastSuccessAt) : "Ingen lyckad hämtning"}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-700">
                        {src.earliestSoldAt && src.latestSoldAt
                          ? `${src.earliestSoldAt} → ${src.latestSoldAt}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                        {SEK.format(src.listingCount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {partial.length > 0 && (
            <p className="text-xs text-amber-700">
              {partial
                .map((p) => `${sourceLabel(p.source)} (${districtName(p.district)})`)
                .join(", ")}
              : senaste hämtningen avbröts i förtid, så de allra senaste affärerna kan saknas.
            </p>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Movers({
  title,
  subtitle,
  entries,
}: {
  title: string;
  subtitle: string;
  entries: Awaited<ReturnType<typeof topMovers>>;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-base font-medium text-zinc-900">{title}</h3>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">Otillräckligt underlag.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {entries.map((m) => {
            const pos = m.pctChange >= 0;
            return (
              <li key={`${m.district}-${m.slug}`}>
                <Link
                  href={`/street/${m.district}/${m.slug}`}
                  className="flex items-center justify-between gap-3 py-2 hover:bg-zinc-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900">{m.street}</p>
                    <p className="text-[11px] text-zinc-500">
                      {districtName(m.district)}
                    </p>
                    <p className="text-[11px] text-zinc-600">
                      Senaste 90 dagar: {SEK.format(m.recentMedianPricePerSqm)} kr/m² ({formatSales(m.recentCount)})
                    </p>
                    <p className="text-[11px] text-zinc-600">
                      Föregående 12 månader: {SEK.format(m.priorMedianPricePerSqm)} kr/m² ({formatSales(m.priorCount)})
                    </p>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums " +
                      (pos
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700")
                    }
                  >
                    {PCT.format(m.pctChange / 100)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
