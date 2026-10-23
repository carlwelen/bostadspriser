import { useCallback, useEffect, useState } from "react";
import type { AddressResponse, Period } from "@/lib/api-types";
import { fetchJson } from "./fetchJson";

export type AddressQuery = {
  district: string;
  street: string;
  houseNumber: string | null;
};

type Settled = { key: string; data: AddressResponse | null; error: boolean };

/**
 * Fetches the address/street series. Each result remembers the key (address,
 * period, reload counter) it was fetched for, and only counts for that key: a
 * different address or period reads as loading right away, never as the
 * previous one's data. `data` is only ever set from an ok response.
 */
export function useAddressData(query: AddressQuery | null, period: Period) {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const district = query?.district;
  const street = query?.street;
  const houseNumber = query?.houseNumber;
  const key = district && street ? JSON.stringify([district, street, houseNumber, period, reloadKey]) : null;

  useEffect(() => {
    if (!district || !street || !key) return;
    let cancelled = false;
    const params = new URLSearchParams({ district, street, period });
    if (houseNumber) params.set("house", houseNumber);
    fetchJson<AddressResponse>(`/api/address?${params}`)
      .then((data) => {
        if (!cancelled) setSettled({ key, data, error: false });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("address fetch failed", err);
          setSettled({ key, data: null, error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, district, street, houseNumber, period]);

  const current = key !== null && settled?.key === key ? settled : null;
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  return {
    data: current?.data ?? null,
    loading: key !== null && current === null,
    error: current?.error ?? false,
    reload,
  };
}
