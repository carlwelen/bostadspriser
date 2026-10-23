import type { Metadata } from "next";
import Link from "next/link";

import { Histogram } from "@/components/Histogram";
import { PageHero } from "@/components/PageHero";
import { PriceAreaScatter } from "@/components/PriceAreaScatter";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StatCard } from "@/components/StatCard";
import {
  globalSummary,
  pricePerSqmDistribution,
  priceAreaSample,
  roomsBreakdown,
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

export const metadata: Metadata = {
  title: "Insikter — bostadspriser",
  description:
    "Aggregerade mönster i Stockholms innerstad: prisfördelning, rumssegment, gator som rört sig mest.",
};

export default async function InsightsPage() {
  const [summary, distribution, rooms, scatter, moversUp, moversDown] =
    await Promise.all([
      globalSummary(),
      pricePerSqmDistribution(BUCKET_WIDTH),
      roomsBreakdown(),
      priceAreaSample(800),
      topMovers("up", 6),
      topMovers("down", 6),
    ]);

  return (
    <>
      <SiteHeader crumbs={[{ label: "Insikter" }]} />
      <PageHero
        kicker="Insikter"
        title="Mönster i Stockholms innerstad"
        accent="Stockholms innerstad"
        subtitle={
          summary.earliest && summary.latest
            ? `Aggregerade slutpriser från ${summary.earliest} till ${summary.latest}. Allt räknas i SQL — inga sammanfattningar i frontend.`
            : "Underlaget laddas in löpande från Hemnet och Booli."
        }
      />
      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">


        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Försäljningar" value={SEK.format(summary.total)} />
          <StatCard
            label="Medel pris/m²"
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
          <Movers title="Stigande gator" subtitle="Senaste 90 dagar vs hela perioden" entries={moversUp} />
          <Movers title="Fallande gator" subtitle="Senaste 90 dagar vs hela perioden" entries={moversDown} />
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
              Medelvärden grupperade efter antal rum
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Rum</th>
                  <th className="px-4 py-3 font-medium">Antal</th>
                  <th className="px-4 py-3 text-right font-medium">Medel yta</th>
                  <th className="px-4 py-3 text-right font-medium">Medel pris</th>
                  <th className="px-4 py-3 text-right font-medium">Medel pris/m²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rooms.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-zinc-500">
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
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-900">
                        {SEK.format(r.meanPricePerSqm)} kr
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
                      {districtName(m.district)} • {m.count} sålda • medel{" "}
                      {SEK.format(m.meanPricePerSqm)} kr/m²
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
