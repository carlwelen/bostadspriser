import Link from "next/link";

/**
 * Brand mark: a single-color geometric monogram.
 * The glyph is a stacked "B" with a baseline tick — reads as both a building
 * silhouette and a data-point on an axis. No gradients, no glow.
 */
export function BrandMark({
  href = "/",
  invert = false,
  showWordmark = true,
}: {
  href?: string;
  invert?: boolean;
  showWordmark?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "group inline-flex items-center gap-2.5 text-sm font-semibold tracking-tight transition-colors " +
        (invert ? "text-zinc-50 hover:text-white" : "text-zinc-900 hover:text-zinc-700")
      }
    >
      <span
        className={
          "relative inline-grid h-7 w-7 place-items-center rounded-md transition-colors " +
          (invert
            ? "bg-white/10 ring-1 ring-inset ring-white/15"
            : "bg-zinc-900")
        }
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          width="14"
          height="14"
          className={invert ? "text-white" : "text-white"}
          fill="none"
        >
          {/* Stacked-bar / building silhouette. Three rising columns + baseline. */}
          <path
            d="M3 14V8M3 14H17M7 14V5M11 14V10M15 14V3"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {showWordmark && (
        <span className="flex items-baseline gap-1.5">
          <span className="tracking-[-0.01em]">Bostadspriser</span>
          <span
            className={
              "text-[10px] font-medium uppercase tracking-[0.18em] " +
              (invert ? "text-zinc-400" : "text-zinc-400")
            }
          >
            sthlm
          </span>
        </span>
      )}
    </Link>
  );
}
