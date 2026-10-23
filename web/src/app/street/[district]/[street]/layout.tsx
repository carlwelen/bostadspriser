import { notFound } from "next/navigation";
import { resolveStreet } from "../../resolveStreet";

// Unknown districts and streets must 404 before the overview's loading.tsx
// Suspense boundary starts streaming a 200 (F26).
export default async function StreetLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ district: string; street: string }>;
}) {
  const { district, street } = await params;
  if (!(await resolveStreet(district, street))) notFound();
  return children;
}
