import { MapPage } from "@/components/map/MapPage";

// Reading `searchParams` makes this route dynamic, so the nav and the sidebar
// are server-rendered for the requested filters. A static page with a
// client-side useSearchParams() would ship a bare client-render bailout
// instead: blank until hydration, and blank without JavaScript.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await searchParams;
  return <MapPage />;
}
