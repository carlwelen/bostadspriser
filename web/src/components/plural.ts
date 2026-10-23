import { salesWord } from "./map/format";

const SEK_COUNT = new Intl.NumberFormat("sv-SE");

/** "såld" for exactly one, "sålda" otherwise (also for 0). */
export function soldWord(count: number): string {
  return count === 1 ? "såld" : "sålda";
}

/** "1 såld", "14 sålda", "1 234 sålda". */
export function formatSold(count: number): string {
  return `${SEK_COUNT.format(count)} ${soldWord(count)}`;
}

/** "1 försäljning", "28 försäljningar". */
export function formatSales(count: number): string {
  return `${SEK_COUNT.format(count)} ${salesWord(count)}`;
}
