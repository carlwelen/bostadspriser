import { SiteHeader } from "./SiteHeader";

export function AnalyticsLoading({ title }: { title: string }) {
  return (
    <>
      <SiteHeader />
      <main aria-busy="true" className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <p role="status" className="text-sm text-zinc-600">Laddar {title}…</p>
        <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
          <div className="h-9 w-48 max-w-full rounded bg-zinc-200" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl border border-zinc-200 bg-zinc-100" />)}
          </div>
          <div className="h-72 rounded-2xl border border-zinc-200 bg-zinc-100" />
        </div>
      </main>
    </>
  );
}
