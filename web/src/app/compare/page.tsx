import Link from "next/link";
import { ComparisonNavigation } from "@/components/ComparisonNavigation";
import { CompareBuilder } from "@/components/CompareBuilder";
import { CHART_COLORS } from "@/components/chartColors";
import { comparisonHref, comparisonIds, parseComparisonSpec, type ComparisonSpec } from "@/components/comparison";
import { GranularityToggle } from "@/components/GranularityToggle";
import { granularityCaption, parseGranularity } from "@/components/granularity";
import { PageHero } from "@/components/PageHero";
import { PriceChart, type Series } from "@/components/PriceChart";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import {
  districtTimeseries,
  listAllStreets,
  streetFromSlug,
  type Granularity,
  streetTimeseries,
  type TimeseriesPoint,
} from "@/lib/aggregations";
import {
  DISTRICTS,
  districtName,
} from "@/lib/districts";

export const dynamic = "force-dynamic";

async function loadSeries(spec: ComparisonSpec, granularity: Granularity): Promise<{ name: string; points: TimeseriesPoint[] } | null> {
  if (spec.kind === "district") {
    const points = await districtTimeseries(spec.slug, granularity);
    return { name: districtName(spec.slug), points };
  }
  const street = await streetFromSlug(spec.district, spec.streetSlug);
  if (!street) return null;
  const points = await streetTimeseries(spec.district, street, granularity);
  return { name: `${street} (${districtName(spec.district)})`, points };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string | string[]; g?: string | string[] }>;
}) {
  const sp = await searchParams;
  const granularity = parseGranularity(sp.g);
  const rawSeries = comparisonIds(sp.series);
  const loaded = await Promise.all(rawSeries.map(async (id) => {
    const data = await loadSeries(parseComparisonSpec(id)!, granularity);
    return data ? { ...data, id } : null;
  }));
  const selected = loaded.filter((s): s is NonNullable<typeof s> => !!s)
    .map((s, i) => ({ ...s, color: CHART_COLORS[i % CHART_COLORS.length] }));
  const series: Series[] = selected;
  const streets = await listAllStreets();
  const options = [
    ...DISTRICTS.map((d) => ({ id: `district:${d.slug}`, name: d.displayName, color: "" })),
    ...streets.map((s) => ({ id: `street:${s.district}/${s.slug}`, name: `${s.street} (${districtName(s.district)})`, color: "" })),
  ];

  return (
    <>
      <SiteHeader crumbs={[{ label: "Jämför" }]} />
      <PageHero
        kicker="Jämförelse"
        title={
          series.length === 0
            ? "Inga serier valda"
            : series.map((s) => s.name).join(" vs ")
        }
        subtitle={`${granularityCaption(granularity)}. Välj gator och stadsdelar att jämföra i samma graf.`}
      />
      <ComparisonNavigation>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <section aria-label="Prisjämförelse" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex justify-end">
            <GranularityToggle granularity={granularity} path="/compare" params={sp} />
          </div>
          <PriceChart series={series} granularity={granularity} />
        </section>
        <CompareBuilder options={[...new Map(options.map((o) => [o.id, o])).values()]} selected={selected.map(({ id, name, color }) => ({ id, name, color }))} granularity={granularity} />
        <section aria-label="Snabbval" className="flex flex-wrap gap-2">
          {DISTRICTS.map((d) => {
            const id = `district:${d.slug}`;
            const ids = selected.map((s) => s.id);
            const active = ids.includes(id);
            return <Link key={id} href={comparisonHref(active ? ids.filter((value) => value !== id) : [...ids, id], granularity)}
              aria-current={active ? "true" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>
              {d.displayName}
            </Link>;
          })}
        </section>

      </main>
      </ComparisonNavigation>
      <SiteFooter />
    </>
  );
}
