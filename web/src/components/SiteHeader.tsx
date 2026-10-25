"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "./BrandMark";
import { MobileNav } from "./MobileNav";
import { StreetSearch } from "./StreetSearch";

type Crumb = { label: string; href?: string };

export function SiteHeader({ crumbs = [] }: { crumbs?: Crumb[] }) {
  const [selectionKey, setSelectionKey] = useState(0);
  return (
    <StreetSearch onSelect={() => setSelectionKey((key) => key + 1)} renderTrigger={(openSearch) => <header className="sticky top-0 z-30 border-b border-zinc-200/70">
      {/* The blur sits on its own layer: backdrop-filter on the header itself would make
          it the containing block of the fixed street-search overlay inside it. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-white/75 backdrop-blur" />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        {/* The "STHLM" tag only fits from md up; below it the bar also holds the menu button. */}
        <span className="md:hidden">
          <BrandMark compact />
        </span>
        <span className="hidden md:block">
          <BrandMark />
        </span>
        <MobileNav crumbs={crumbs} openSearch={openSearch} selectionKey={selectionKey} />
        <nav aria-label="Brödsmulor" className="hidden items-center gap-1 text-sm text-zinc-500 md:flex">
          {crumbs.length > 0 ? (
            <>
              <Link href="/" className="rounded px-2 py-1 hover:bg-zinc-100">
                Karta
              </Link>
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="contents">
                  <span aria-hidden className="text-zinc-300">›</span>
                  {c.href ? (
                    <Link href={c.href} className="rounded px-2 py-1 hover:bg-zinc-100">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="rounded px-2 py-1 text-zinc-900">{c.label}</span>
                  )}
                </span>
              ))}
            </>
          ) : null}
        </nav>
        <nav aria-label="Huvudnavigation" className="hidden items-center gap-2 text-sm md:flex">
          <Link
            href="/insights"
            className="rounded-md px-3 py-1.5 text-zinc-700 hover:bg-zinc-100"
          >
            Insikter
          </Link>
          <Link
            href="/compare"
            className="rounded-md px-3 py-1.5 text-zinc-700 hover:bg-zinc-100"
          >
            Jämför
          </Link>
          <button type="button" aria-haspopup="dialog" onClick={openSearch} className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            Sök gata
          </button>
        </nav>
      </div>
    </header>} />
  );
}
