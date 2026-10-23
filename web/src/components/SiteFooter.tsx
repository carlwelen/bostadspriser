import Link from "next/link";
import { DISTRICTS } from "@/lib/districts";

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © Bostadspriser · Slutpriser i Stockholms innerstad. Källa: Hemnet
          &amp; Booli.
        </p>
        <nav className="flex gap-4">
          <Link href="/" className="transition-colors duration-200 hover:text-zinc-900">
            Karta
          </Link>
          <Link href="/insights" className="transition-colors duration-200 hover:text-zinc-900">
            Insikter
          </Link>
          <Link href="/compare" className="transition-colors duration-200 hover:text-zinc-900">
            Jämför
          </Link>
          {DISTRICTS.map(({ slug, displayName }) => (
            <Link
              key={slug}
              href={`/district/${slug}`}
              className="transition-colors duration-200 hover:text-zinc-900"
            >
              {displayName}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
