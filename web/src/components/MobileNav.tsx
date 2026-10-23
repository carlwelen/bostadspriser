"use client";

import Link from "next/link";
import { useState } from "react";
import { StreetSearch } from "./StreetSearch";

export type NavCrumb = { label: string; href?: string };

const LINK =
  "rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:bg-zinc-100";

/**
 * Below the md breakpoint the header's crumbs and links don't fit, so they
 * collapse into a "Meny" disclosure. Rendered inside `SiteHeader`; hidden from
 * md up, where the full nav is shown instead.
 */
export function MobileNav({ crumbs }: { crumbs: NavCrumb[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
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
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        Meny
      </button>
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Huvudmeny"
          // Close when a link is followed; the search button manages its own dialog.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
          className="absolute inset-x-0 top-full border-b border-zinc-200 bg-white px-4 pb-4 pt-2 shadow-sm"
        >
          <ul className="flex flex-col">
            <li>
              <Link href="/" className={`block ${LINK}`}>
                Karta
              </Link>
            </li>
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`}>
                {c.href ? (
                  <Link href={c.href} className={`block ${LINK}`}>
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="block px-3 py-2 text-sm font-medium text-zinc-900">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
            <li>
              <Link href="/insights" className={`block ${LINK}`}>
                Insikter
              </Link>
            </li>
            <li>
              <Link href="/compare" className={`block ${LINK}`}>
                Jämför
              </Link>
            </li>
            <li className="px-3 pt-2">
              <StreetSearch />
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
