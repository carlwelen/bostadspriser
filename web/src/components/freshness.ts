import type { LatestScrapeRun, SourceFreshness } from "@/lib/aggregations";

/** "20 mars 2026 kl. 09:00": an instant (ISO, UTC) as Stockholm wall-clock time. */
export function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  });
}

/** When the dataset was last refreshed: the newest successful run of any source. */
export function latestUpdate(sources: SourceFreshness[]): string | null {
  let best: string | null = null;
  for (const s of sources) {
    if (s.lastSuccessAt && (best === null || Date.parse(s.lastSuccessAt) > Date.parse(best))) {
      best = s.lastSuccessAt;
    }
  }
  return best;
}

const SOURCE_LABELS: Record<string, string> = { hemnet: "Hemnet", booli: "Booli" };

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

/** (source, district) pairs whose latest run stopped early, so recent sales may be missing. */
export function partialRuns(
  runs: LatestScrapeRun[]
): Array<{ source: string; district: LatestScrapeRun["district"] }> {
  return runs
    .filter((r) => r.status === "partial")
    .map((r) => ({ source: r.source, district: r.district }));
}
