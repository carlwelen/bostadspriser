import { PRICE_COLORS, formatBreakLabels } from "./priceRamp";

/** Legend for the price layer; `breaks` are the ones the map colours with. */
export function PriceLegend({ breaks }: { breaks: number[] }) {
  const labels = formatBreakLabels(breaks);
  return (
    <div className="text-xs" data-testid="price-legend">
      <p className="text-zinc-500">Pris/m² (kr)</p>
      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full">
        {PRICE_COLORS.map((color) => (
          <div key={color} style={{ background: color }} className="flex-1" />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        {labels.map((label, i) => (
          <span key={`${i}-${label}`}>{label}</span>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">Skalan anpassas efter urvalet.</p>
    </div>
  );
}
