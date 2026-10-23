import { useEffect, useState } from "react";
import { fetchJson } from "./fetchJson";

export type Period = "30d" | "3mo" | "12mo" | "all";

// TODO(F30): import from @/lib/api-types once it lands on main.
export type AddressResponse = {
  district: string;
  street: string;
  house: string | null;
  period: Period;
  granularity: "day" | "week" | "month";
  streetSeries: Array<{ bucket: string; meanPricePerSqm: number; count: number }>;
  addressSales: Array<{
    soldAt: string;
    priceSek: number;
    pricePerSqmSek: number;
    sources: string[];
  }>;
};

export type AddressQuery = {
  district: string;
  street: string;
  houseNumber: string | null;
};

/** Fetches the address/street series; `data` is only ever set from an ok response. */
export function useAddressData(query: AddressQuery | null, period: Period) {
  const [data, setData] = useState<AddressResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const district = query?.district;
  const street = query?.street;
  const houseNumber = query?.houseNumber;

  useEffect(() => {
    if (!district || !street) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ district, street, period });
    if (houseNumber) params.set("house", houseNumber);
    fetchJson<AddressResponse>(`/api/address?${params}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("address fetch failed", err);
          // Drop the previous period's data rather than show it as current.
          setData(null);
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [district, street, houseNumber, period]);

  return { data, loading, error };
}
