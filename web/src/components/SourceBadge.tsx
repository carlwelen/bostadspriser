/** Small chip indicating which source(s) reported a sale. */
export function SourceBadge({
  sources,
  size = "sm",
}: {
  sources: readonly string[];
  size?: "xs" | "sm";
}) {
  if (!sources?.length) return null;

  const cls = size === "xs"
    ? "text-[10px] px-1.5 py-0.5 gap-1"
    : "text-[11px] px-2 py-0.5 gap-1.5";

  return (
    <span
      className={`inline-flex items-center rounded-full bg-zinc-100 font-medium tracking-wide text-zinc-700 ring-1 ring-inset ring-zinc-200 ${cls}`}
      title={`Källa: ${sources.join(" + ")}`}
    >
      {sources.map((src, i) => (
        <span key={src} className="contents">
          {i > 0 && <span aria-hidden className="text-zinc-400">+</span>}
          <span
            className={
              src === "hemnet"
                ? "text-rose-700"
                : src === "booli"
                ? "text-sky-700"
                : "text-zinc-700"
            }
          >
            {src === "hemnet" ? "H" : src === "booli" ? "B" : src[0].toUpperCase()}
          </span>
        </span>
      ))}
    </span>
  );
}
