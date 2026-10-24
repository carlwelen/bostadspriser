import type { DistrictMomChange } from "@/lib/aggregations";
import { formatSales } from "@/components/plural";

const PCT = new Intl.NumberFormat("sv-SE", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** "2026-09-01" -> "september 2026". The date is a calendar day, so read it as UTC. */
export function formatMonthYear(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("sv-SE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type MomDisplay = {
  value: string;
  hint: string;
  tone: "neutral" | "up" | "down";
};

/**
 * What the month-over-month card shows. The change is only reported when both
 * months have at least `minSales` sales; otherwise the card says which months
 * were compared and how thin they are instead of a bare dash.
 */
export function describeMom(mom: DistrictMomChange | null, minSales: number): MomDisplay {
  if (!mom) {
    return {
      value: "—",
      hint: "Inga försäljningar de två senaste hela månaderna.",
      tone: "neutral",
    };
  }
  const prev = formatMonthYear(mom.previousMonth);
  const cur = formatMonthYear(mom.currentMonth);
  if (mom.pctChange == null) {
    return {
      value: "—",
      hint:
        `För få affärer för en jämförelse (minst ${minSales} per månad): ` +
        `${prev}: ${formatSales(mom.previousCount)}, ${cur}: ${formatSales(mom.currentCount)}.`,
      tone: "neutral",
    };
  }
  return {
    value: PCT.format(mom.pctChange / 100),
    hint: `Medelpris/m², ${prev} (${mom.previousCount} st) → ${cur} (${mom.currentCount} st)`,
    tone: mom.pctChange >= 0 ? "up" : "down",
  };
}
