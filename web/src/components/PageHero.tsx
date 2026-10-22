import { ReactNode } from "react";

/**
 * Quiet hero band. Dark surface, no gradients, no pulse.
 * The kicker uses a 1px accent rule + tracked-out caps; the title carries
 * the weight via tight tracking and large size, not color.
 */
type PageHeroProps = {
  kicker: string;
  title: string;
  /**
   * Deprecated: previously highlighted a substring with a brand gradient.
   * Kept in the type to avoid breaking call sites; ignored at render time.
   */
  accent?: string;
  subtitle?: ReactNode;
  trailing?: ReactNode;
};

export function PageHero(props: PageHeroProps) {
  const { kicker, title, subtitle, trailing } = props;
  return (
    <section className="relative overflow-hidden border-b border-zinc-200/70 bg-[#0b0d12] text-white">
      {/* Single hairline of accent at the very top — earns the dark band's keep
          without resorting to glow or pulse. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(96,138,238,0.45),transparent)]"
      />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-6 py-14 sm:py-16 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">
            <span aria-hidden className="h-px w-6 bg-zinc-600" />
            {kicker}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl lg:text-[2.75rem] lg:leading-[1.05]">
            {title}
          </h1>
          {subtitle && (
            <div className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-300 sm:text-[15px]">
              {subtitle}
            </div>
          )}
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
    </section>
  );
}
