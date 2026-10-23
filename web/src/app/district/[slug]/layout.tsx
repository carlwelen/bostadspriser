import { notFound } from "next/navigation";
import { isDistrictSlug } from "@/lib/districts";

// Validated here, above loading.tsx's Suspense boundary: notFound() inside the
// suspended page would arrive after the 200 status has been streamed (F26).
export default async function DistrictLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isDistrictSlug(slug)) notFound();
  return children;
}
