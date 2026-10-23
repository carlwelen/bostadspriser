"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJson } from "./map/fetchJson";
import { districtName, type DistrictSlug } from "@/lib/districts";

type StreetEntry = {
  district: DistrictSlug;
  street: string;
  slug: string;
  count: number;
  meanPricePerSqm: number;
};

const SEK = new Intl.NumberFormat("sv-SE");

/** Fold Swedish diacritics so "ostermalm" matches "Östermalm". */
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e");
}

export function StreetSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [streets, setStreets] = useState<StreetEntry[] | null>(null);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Lazy-load the street index when the search is first opened.
  useEffect(() => {
    if (!open || streets) return;
    setError(false);
    // TODO(F30): import StreetEntry from @/lib/api-types once it lands on main.
    fetchJson<StreetEntry[]>("/api/streets/all")
      .then(setStreets)
      .catch((err) => {
        console.error("street index fetch failed", err);
        setError(true);
      });
  }, [open, streets]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Cmd/Ctrl-K shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    if (!streets) return [] as StreetEntry[];
    const q = fold(query.trim());
    if (!q) return streets.slice(0, 30);
    return streets
      .filter((s) => fold(s.street).includes(q) || fold(districtName(s.district)).includes(q))
      .slice(0, 50);
  }, [streets, query]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors duration-200 ease-out hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
      >
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-zinc-400 transition-colors group-hover:text-zinc-600"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        Sök gata
        <kbd className="hidden rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-500 sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="backdrop-fade fixed inset-0 z-50 grid place-items-start bg-zinc-950/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="drawer-enter mx-auto mt-24 w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_60px_-20px_rgb(15_23_42_/_0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
              <span aria-hidden className="text-zinc-400">🔎</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sök gata eller stadsdel…"
                className="flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
              />
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
              >
                Esc
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {error ? (
                <p role="alert" className="px-4 py-6 text-sm text-red-700">
                  Kunde inte hämta data.
                </p>
              ) : streets === null ? (
                <p className="px-4 py-6 text-sm text-zinc-500">Laddar gator…</p>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-6 text-sm text-zinc-500">
                  Ingen träff på “{query}”.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {filtered.map((s) => (
                    <li key={`${s.district}-${s.slug}`}>
                      <a
                        href={`/street/${s.district}/${s.slug}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-900">{s.street}</p>
                          <p className="text-xs text-zinc-500">
                            {districtName(s.district)} • {s.count} sålda
                          </p>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                          {SEK.format(s.meanPricePerSqm)} kr/m²
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
