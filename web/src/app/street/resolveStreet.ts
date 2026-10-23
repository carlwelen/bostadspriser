import { cache } from "react";
import { streetFromSlug } from "@/lib/aggregations";
import { isDistrictSlug, type DistrictSlug } from "@/lib/districts";

/**
 * Resolves the `[district]/[street]` URL params to a canonical street name, or
 * null if either is unknown. Memoised per request so the layout (which turns
 * null into an HTTP 404 before any Suspense boundary) and the pages share one
 * query.
 */
export const resolveStreet = cache(
  async (
    district: string,
    streetSlug: string
  ): Promise<{ district: DistrictSlug; street: string } | null> => {
    if (!isDistrictSlug(district)) return null;
    const street = await streetFromSlug(district, streetSlug);
    return street ? { district, street } : null;
  }
);
