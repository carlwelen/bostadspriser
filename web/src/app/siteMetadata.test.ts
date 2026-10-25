import { afterEach, expect, it, vi } from "vitest";
import { pageMetadata, siteOrigin } from "./siteMetadata";
import sitemap from "./sitemap";

vi.mock("@/lib/aggregations", () => ({ listStreets: async () => [] }));
afterEach(() => vi.unstubAllEnvs());

it("uses the existing configured origin and removes credentials, paths, queries and fragments", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://user:pass@housing.example/base/?x=1#fragment");
  expect(siteOrigin().href).toBe("https://housing.example/");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
  expect(siteOrigin().href).toBe("http://localhost:3000/");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "ftp://housing.example");
  expect(() => siteOrigin()).toThrow("HTTP or HTTPS");
});

it("keeps page identity and social defaults together without using selection queries as canonical URLs", () => {
  const meta = pageMetadata("Östermalm", "Medianpriser för Östermalm", "/district/ostermalm");
  expect(meta.alternates?.canonical).toBe("/district/ostermalm");
  expect(meta.openGraph).toMatchObject({ title: "Östermalm", description: "Medianpriser för Östermalm", locale: "sv_SE", url: "/district/ostermalm", images: [{ url: "/opengraph-image", width: 1200, height: 630 }] });
  expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "Östermalm" });
});

it("includes insights once and avoids doubled slashes in configured sitemap URLs", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://housing.example/");
  const entries = await sitemap();
  expect(entries.filter((entry) => entry.url === "https://housing.example/insights")).toHaveLength(1);
  expect(entries.every((entry) => !entry.url.includes("example//"))).toBe(true);
});
