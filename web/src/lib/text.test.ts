import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldForSearch, slugifyStreet } from "./text";

// The vectors live at the repo root so the Python scraper can assert against
// the same file (B23).
type Vector = { input: string; expected: string; note?: string };
const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../shared/slug-vectors.json", import.meta.url)), "utf8")
) as { slug: Vector[]; fold: Vector[] };

/** The slug function as it was before B23 (aggregations.ts), kept as a reference. */
function legacySlugifyStreet(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

describe("shared vectors", () => {
  it("has vectors for the cases that matter", () => {
    const inputs = vectors.slug.map((v) => v.input).join("|") + vectors.fold.map((v) => v.input).join("|");
    for (const needle of ["å", "ä", "ö", "é", "è", "ü", "S:t", "-", " ", "  "]) {
      expect(inputs, needle).toContain(needle);
    }
  });

  it.each(vectors.slug.map((v) => [JSON.stringify(v.input), v] as const))(
    "slugifyStreet(%s)",
    (_name, v) => {
      expect(slugifyStreet(v.input)).toBe(v.expected);
    }
  );

  it.each(vectors.fold.map((v) => [JSON.stringify(v.input), v] as const))(
    "foldForSearch(%s)",
    (_name, v) => {
      expect(foldForSearch(v.input)).toBe(v.expected);
    }
  );
});

describe("slugifyStreet", () => {
  it("is identical to the pre-B23 implementation, so existing URLs keep working", () => {
    // Deterministic pseudo-random strings over the characters that occur in street names.
    const alphabet = [..."abcdeghiklmnoprstuvxyzåäöéèüÅÄÖÉ0123456789 -:.,'/ \t"];
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 5000; i++) {
      const len = 1 + (next() % 24);
      const s = Array.from({ length: len }, () => alphabet[next() % alphabet.length]).join("");
      expect(slugifyStreet(s), JSON.stringify(s)).toBe(legacySlugifyStreet(s));
    }
  });

  it("is idempotent and URL-safe", () => {
    for (const v of vectors.slug) {
      const slug = slugifyStreet(v.input);
      expect(slugifyStreet(slug)).toBe(slug);
      expect(slug).toMatch(/^[a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });
});

describe("foldForSearch", () => {
  it("is idempotent", () => {
    for (const v of vectors.fold) expect(foldForSearch(foldForSearch(v.input))).toBe(foldForSearch(v.input));
  });

  it("lets a plain-ASCII query match Swedish names", () => {
    expect(foldForSearch("Östermalm").includes(foldForSearch("ostermalm"))).toBe(true);
    expect(foldForSearch("Sankt Eriksgatan").includes(foldForSearch("sankt eriks"))).toBe(true);
  });

  it("folds at least everything the old StreetSearch fold did", () => {
    const old = (s: string) => s.toLowerCase().replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/é/g, "e");
    for (const s of ["Östermalm", "Götgatan", "Brahégatan", "Karlavägen", "Vasagatan 4"]) {
      expect(foldForSearch(s)).toBe(old(s));
    }
  });
});
