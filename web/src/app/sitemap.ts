import type { MetadataRoute } from "next";
import { DISTRICTS } from "@/lib/districts";
import { listStreets } from "@/lib/aggregations";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/compare`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
  ];

  const districtEntries: MetadataRoute.Sitemap = DISTRICTS.map((d) => ({
    url: `${base}/district/${d.slug}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const streetEntries: MetadataRoute.Sitemap = (
    await Promise.all(
      DISTRICTS.map(async (d) => {
        const streets = await listStreets(d.slug, 500);
        return streets.map((s) => ({
          url: `${base}/street/${d.slug}/${s.slug}`,
          lastModified: new Date(s.latestSoldAt),
          changeFrequency: "weekly" as const,
          priority: 0.5,
        }));
      })
    )
  ).flat();

  return [...staticEntries, ...districtEntries, ...streetEntries];
}
