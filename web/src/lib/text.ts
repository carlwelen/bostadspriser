// The one place that turns Swedish street names into URL slugs and search keys.
// Vectors shared with the Python scraper: shared/slug-vectors.json.

/** Diacritics folded everywhere (slugs and search). */
const BASE_FOLD: Record<string, string> = { å: "a", ä: "a", ö: "o", é: "e" };
/** Further diacritics folded for search only. Slugs must not fold these: existing URLs would change. */
const SEARCH_FOLD: Record<string, string> = { ...BASE_FOLD, è: "e", ü: "u" };

const foldWith = (map: Record<string, string>, s: string) =>
  s.toLowerCase().replace(/[åäöéèü]/g, (c) => map[c] ?? c);

/**
 * Stable, URL-safe slug for a Swedish street name ("S:t Eriksgatan" ->
 * "s-t-eriksgatan"). Every run of characters outside a-z0-9 becomes one dash,
 * so spaces, NBSP, colons and hyphens all collapse alike. Round-trips through
 * the street list (see `streetFromSlug`). Its output for existing streets must
 * never change, or their URLs break.
 */
export function slugifyStreet(name: string): string {
  return foldWith(BASE_FOLD, name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Key for case- and diacritic-insensitive search: "Östermalm" and "ostermalm"
 * fold to the same string. Also turns NBSP and runs of whitespace into single
 * spaces and trims.
 */
export function foldForSearch(s: string): string {
  return foldWith(SEARCH_FOLD, s)
    .replace(/[\s ]+/g, " ")
    .trim();
}
