/** "försäljning" for exactly one, "försäljningar" otherwise (also for 0). */
export function salesWord(count: number): string {
  return count === 1 ? "försäljning" : "försäljningar";
}

/** "såld" for exactly one, "sålda" otherwise (also for 0). */
export function soldWord(count: number): string {
  return count === 1 ? "såld" : "sålda";
}

const SEK_COUNT = new Intl.NumberFormat("sv-SE");

/** "1 försäljning i urvalet", "28 försäljningar i urvalet". */
export function formatSalesInSelection(count: number): string {
  return `${SEK_COUNT.format(count)} ${salesWord(count)} i urvalet`;
}
