import { SiteHeader } from "@/components/SiteHeader";

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <div className="space-y-3">
          <div className="h-3 w-16 animate-pulse rounded bg-zinc-200" />
          <div className="h-9 w-72 animate-pulse rounded bg-zinc-200" />
          <div className="h-3 w-56 animate-pulse rounded bg-zinc-200" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100"
            />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100" />
      </main>
    </>
  );
}
