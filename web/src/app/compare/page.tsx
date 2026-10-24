import Link from "next/link";
import { GranularityToggle } from "@/components/GranularityToggle";
import { granularityHref, granularityCaption, parseGranularity } from "@/components/granularity";
import { PageHero } from "@/components/PageHero";
import { PriceChart, type Series } from "@/components/PriceChart";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import {
  districtTimeseries,
  streetFromSlug,
  type Granularity,
  streetTimeseries,
  type TimeseriesPoint,
} from "@/lib/aggregations";
import {
  DISTRICTS,
  districtName,
  isDistrictSlug,
  type DistrictSlug,
} from "@/lib/districts";

export const dynamic = "force-dynamic";

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];

type ParsedSpec =
  | { kind: "district"; slug: DistrictSlug }
  | { kind: "street"; district: DistrictSlug; streetSlug: string };

function parseSpec(raw: string): ParsedSpec | null {
  const [kind, ...rest] = raw.split(":");
  if (kind === "district") {
    const slug = rest.join(":");
    return isDistrictSlug(slug) ? { kind, slug } : null;
  }
  if (kind === "street") {
    const path = rest.join(":");
    const [district, streetSlug] = path.split("/");
    return district && isDistrictSlug(district) && streetSlug
      ? { kind, district, streetSlug }
      : null;
  }
  return null;
}

async function loadSeries(spec: ParsedSpec, granularity: Granularity): Promise<{ name: string; points: TimeseriesPoint[] } | null> {
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
  const rawSeries = sp.series
    ? (Array.isArray(sp.series) ? sp.series : sp.series.split(",")).filter(Boolean)
    : DISTRICTS.map((d) => `district:${d.slug}`);

  const specs = rawSeries.map(parseSpec).filter((x): x is ParsedSpec => !!x);
  const loaded = await Promise.all(specs.map((spec) => loadSeries(spec, granularity)));
  const series: Series[] = loaded
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }));

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
        subtitle={
          <span>
            {granularityCaption(granularity)}. Lägg till serier via URL:
            <code className="mx-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-zinc-100">
              ?series=district:ostermalm,district:vasastan
            </code>
          </span>
        }
      />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex justify-end">
            <GranularityToggle granularity={granularity} path="/compare" params={sp} />
          </div>
          <PriceChart series={series} granularity={granularity} />
        </section>

        <DistrictPresets active={rawSeries} granularity={granularity} />
      </main>
      <SiteFooter />
    </>
  );
}

function DistrictPresets({
  active,
  granularity,
}: {
  active: string[];
  granularity: Granularity;
}) {
  const inSet = new Set(active);
  return (
    <section>
      <p className="mb-2 text-xs text-zinc-500">Snabbval</p>
      <div className="flex flex-wrap gap-2">
        {DISTRICTS.map((d) => {
          const id = `district:${d.slug}`;
          const set = new Set(active);
          if (set.has(id)) set.delete(id);
          else set.add(id);
          const next = [...set].join(",");
          return (
            <Link
              key={d.slug}
              href={granularityHref("/compare", next ? { series: next } : {}, granularity)}
              className={
                "rounded-full border px-3 py-1.5 text-sm transition " +
                (inSet.has(id)
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300")
              }
            >
              {d.displayName}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
