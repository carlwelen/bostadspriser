import { ReactNode } from "react";

type Tone = "neutral" | "up" | "down" | "brand";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "text-zinc-900",
  up: "text-emerald-600",
  down: "text-rose-600",
  // "brand" was previously a gradient. Now it's the single accent color.
  brand: "text-[color:var(--accent)]",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="group relative min-w-0 rounded-xl border border-zinc-200 bg-white p-5 [overflow-wrap:anywhere] transition-[border-color,box-shadow] duration-200 ease-out hover:border-zinc-300 hover:shadow-[0_1px_2px_rgb(0_0_0_/_0.02),0_8px_24px_-16px_rgb(15_23_42_/_0.12)]">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
      <p className={`mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-tight ${TONE_CLASSES[tone]}`}>
        {value}
      </p>
      {hint && <p className="mt-2 text-xs leading-relaxed text-zinc-500">{hint}</p>}
    </div>
  );
}
