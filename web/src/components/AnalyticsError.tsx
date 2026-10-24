"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SiteHeader } from "./SiteHeader";

/** Server errors may include private query details; show only a useful public message. */
export function AnalyticsError({ title, reset }: { title: string; reset: () => void }) {
  const router = useRouter();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div role="alert" className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-zinc-900">Kunde inte ladda {title}</h1>
          <p className="max-w-xl text-sm text-zinc-600">Uppgifterna kunde inte hämtas just nu. Försök igen om en stund. Ditt urval finns kvar i sidans adress.</p>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => { router.refresh(); reset(); }}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">Försök igen</button>
            <Link href="/" className="rounded text-sm text-zinc-700 underline underline-offset-4">Till kartan</Link>
          </div>
        </div>
      </main>
    </>
  );
}
