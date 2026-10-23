import { notFound } from "next/navigation";
import { recentSales } from "@/lib/aggregations";
import { resolveStreet } from "../../../resolveStreet";

// Unknown addresses must 404 before this segment's loading.tsx Suspense
// boundary starts streaming a 200 (F26). One-row existence probe only.
export default async function AddressLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ district: string; street: string; house: string }>;
}) {
  const { district, street: streetSlug, house } = await params;
  const resolved = await resolveStreet(district, streetSlug);
  if (!resolved) notFound();
  const sales = await recentSales(
    { district: resolved.district, street: resolved.street, houseNumber: decodeURIComponent(house) },
    1
  );
  if (sales.length === 0) notFound();
  return children;
}
