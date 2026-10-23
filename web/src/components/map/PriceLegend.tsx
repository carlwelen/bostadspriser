import { DEFAULT_PRICE_BREAKS, PRICE_COLORS, formatBreakLabels } from "./priceRamp";

/**
 * Legend for the price layer; `breaks` are the ones the map colours with. The
 * map interpolates linearly between the stops, so the legend is a gradient with
 * each label under its own colour stop (0/25/50/75/100 %).
 */
export function PriceLegend({ breaks }: { breaks: number[] }) {
  const labels = formatBreakLabels(breaks);
  const isDefault = breaks.every((b, i) => b === DEFAULT_PRICE_BREAKS[i]);
  return (
    <div className="text-xs" data-testid="price-legend">
      <p className="text-zinc-500">Pris/m² (kr)</p>
      <div
        className="mt-1.5 h-2 w-full rounded-full"
        style={{ background: `linear-gradient(to right, ${PRICE_COLORS.join(", ")})` }}
      />
      <div className="relative mt-1 h-3.5 text-[10px] text-zinc-500">
        {labels.map((label, i) => (
          <span
            key={`${i}-${label}`}
            className="absolute whitespace-nowrap"
            style={{ left: `${i * 25}%`, transform: `translateX(-${i * 25}%)` }}
          >
            {label}
          </span>
        ))}
      </div>
      {!isDefault && <p className="mt-1 text-[10px] text-zinc-500">Skalan anpassas efter urvalet.</p>}
    </div>
  );
}
