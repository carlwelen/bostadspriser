"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "./map/fetchJson";
import { registerModal } from "./map/focusTrap";
import { soldWord } from "./map/format";
import { districtName } from "@/lib/districts";
import type { StreetsAllItem } from "@/lib/api-types";
import { foldForSearch } from "@/lib/text";

const SEK = new Intl.NumberFormat("sv-SE");

const hrefOf = (s: StreetsAllItem) => `/street/${s.district}/${s.slug}`;

/**
 * Street search: a modal combobox. Up/Down arrows move the active
 * option (aria-activedescendant), Enter opens it, Escape closes and returns
 * focus to the trigger, Tab stays inside, and the page behind does not scroll.
 */
export function StreetSearch({ renderTrigger }: { renderTrigger?: (openSearch: () => void) => React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [streets, setStreets] = useState<StreetsAllItem[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const optionId = useCallback((i: number) => `${listboxId}-opt-${i}`, [listboxId]);

  // Whatever had focus when the search opened gets it back on close: the
  // trigger normally, an element inside the address drawer when Cmd/Ctrl-K was
  // pressed over it.
  const openerRef = useRef<HTMLElement | null>(null);
  const openSearch = useCallback(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const back = openerRef.current && document.contains(openerRef.current) ? openerRef.current : triggerRef.current;
    back?.focus();
  }, []);

  // Lazy-load the street index when the search is first opened.
  useEffect(() => {
    if (!open || streets) return;
    let cancelled = false;
    setError(false);
    fetchJson<StreetsAllItem[]>("/api/streets/all")
      .then((data) => {
        if (!cancelled) setStreets(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("street index fetch failed", err);
          setError(true);
        }
      });
    return () => { cancelled = true; };
  }, [open, streets, reloadKey]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Cmd/Ctrl-K toggles the search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, openSearch]);

  // Esc, Tab trapping and the scroll lock only exist while the search is open,
  // and only the topmost modal reacts (see registerModal).
  useEffect(() => {
    if (!open) return;
    return registerModal(() => dialogRef.current, close);
  }, [open, close]);

  const filtered = useMemo(() => {
    if (!streets) return [] as StreetsAllItem[];
    const q = foldForSearch(query);
    if (!q) return streets.slice(0, 30);
    return streets
      .filter((s) => foldForSearch(s.street).includes(q) || foldForSearch(districtName(s.district)).includes(q))
      .slice(0, 50);
  }, [streets, query]);

  // A new result list starts without an active option.
  useEffect(() => setActive(-1), [query, open]);

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, optionId]);

  const go = (s: StreetsAllItem) => {
    close();
    router.push(hrefOf(s));
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = filtered.length;
    if (n === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(filtered[active >= 0 ? active : 0]);
    }
  };

  const status = error
    ? ""
    : streets === null
      ? "Laddar gator…"
      : `${filtered.length} ${filtered.length === 1 ? "träff" : "träffar"}`;

  return (
    <>
      {renderTrigger ? renderTrigger(openSearch) : <button
        ref={triggerRef}
        type="button"
        onClick={openSearch}
        aria-label="Sök gata"
        aria-haspopup="dialog"
        className="group inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 sm:px-3 text-sm font-medium text-zinc-700 transition-colors duration-200 ease-out hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
      >
        <SearchIcon className="text-zinc-400 transition-colors group-hover:text-zinc-600" />
        <span className="hidden sm:inline">Sök gata</span>
        <kbd className="hidden rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-500 sm:inline">
          ⌘K
        </kbd>
      </button>}

      {open && (
        <div
          className="backdrop-fade fixed inset-0 z-[60] grid place-items-start bg-zinc-950/30 backdrop-blur-sm"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Sök gata"
            className="drawer-enter mx-auto mt-24 w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_60px_-20px_rgb(15_23_42_/_0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
              <SearchIcon className="text-zinc-500" />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded={filtered.length > 0}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                aria-label="Sök gata eller stadsdel"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Sök gata eller stadsdel…"
                className="flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={close}
                aria-label="Stäng sökningen"
                className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
              >
                Esc
              </button>
            </div>
            <p role="status" className="sr-only">
              {status}
            </p>
            <div className="max-h-[60vh] overflow-y-auto">
              {error ? (
                <div role="alert" className="px-4 py-6 text-sm text-red-700">
                  <p>Kunde inte hämta data.</p>
                  <button
                    type="button"
                    className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 font-medium hover:bg-red-50"
                    onClick={() => {
                      setReloadKey((key) => key + 1);
                      inputRef.current?.focus();
                    }}
                  >
                    Försök igen
                  </button>
                </div>
              ) : streets === null ? (
                <p className="px-4 py-6 text-sm text-zinc-500">Laddar gator…</p>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-6 text-sm text-zinc-500">Ingen träff på ”{query}”.</p>
              ) : null}
              <ul
                id={listboxId}
                role="listbox"
                aria-label="Gator"
                hidden={filtered.length === 0}
                className="divide-y divide-zinc-100"
              >
                {filtered.map((s, i) => (
                  <li
                    key={`${s.district}-${s.slug}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => go(s)}
                    className={
                      "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50 " +
                      (i === active ? "bg-zinc-100" : "")
                    }
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-900">{s.street}</p>
                      <p className="text-xs text-zinc-500">
                        {districtName(s.district)} • {s.count} {soldWord(s.count)}
                      </p>
                    </div>
                    <span title="Medianpris per kvadratmeter" className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {SEK.format(s.medianPricePerSqm)} kr/m²
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
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
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
