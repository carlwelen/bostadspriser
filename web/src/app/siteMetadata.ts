import type { Metadata } from "next";

export const SITE_TITLE = "Bostadspriser — Stockholms innerstad";
export const SITE_DESCRIPTION = "Slutpriser och prisutveckling i Stockholms innerstad";
export const SOCIAL_IMAGE_ALT = "Bostadspriser – slutpriser och prisutveckling i Stockholms innerstad";

/** Reuse the existing sitemap deployment setting; the fallback is local development only. */
export function siteOrigin(): URL {
  const configured = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  if (configured.protocol !== "https:" && configured.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use HTTP or HTTPS");
  }
  return new URL(configured.origin);
}

export function pageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website", locale: "sv_SE", siteName: "Bostadspriser",
      title, description, url: path,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
  };
}
