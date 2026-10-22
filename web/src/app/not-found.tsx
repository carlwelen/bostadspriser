import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid min-h-[60vh] max-w-2xl place-items-center px-6">
        <div className="text-center">
          <p className="text-xs uppercase tracking-wider text-zinc-500">404</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
            Sidan hittades inte
          </h1>
          <p className="mt-3 text-sm text-zinc-600">
            Det kan hända att gatan eller adressen inte har några registrerade
            försäljningar i underlaget ännu.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link
              href="/"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
            >
              Till kartan
            </Link>
            <Link
              href="/compare"
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:border-zinc-300"
            >
              Jämför stadsdelar
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
