import { useEffect, useRef, useState } from "react";
import type { AddressResponse } from "@/lib/api-types";
import { formatSales } from "../plural";

const SEK = new Intl.NumberFormat("sv-SE");

export function StreetDot({ cx, cy, payload }: {
  cx?: number; cy?: number; payload?: { trend: number | null; count: number };
}) {
  if (cx == null || cy == null || payload?.trend == null) return <g />;
  const sparse = payload.count < 3;
  return <circle cx={cx} cy={cy} r={sparse ? 4 : 2.5} fill={sparse ? "white" : "#1d4ed8"}
    stroke="#1d4ed8" strokeWidth={sparse ? 2 : 1} aria-label={formatSales(payload.count)} />;
}

export function DrawerTooltip({ active, label, data }: {
  active?: boolean; label?: string | number; data: AddressResponse | null;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ scrollable: boolean; offsetY: number; maxHeight?: number }>({ scrollable: false, offsetY: 0 });
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let clip = content.parentElement;
    while (clip && !/auto|scroll|hidden|clip/.test(getComputedStyle(clip).overflowY)) clip = clip.parentElement;
    const measure = () => {
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
      const bounds = clip?.getBoundingClientRect();
      const top = Math.max(viewportTop, bounds?.top ?? viewportTop) + 4;
      const bottom = Math.min(viewportBottom, bounds?.bottom ?? viewportBottom) - 4;
      const maxHeight = Math.max(0, bottom - top);
      // The wrapper remains at its chart coordinate while this content follows the visible scroll area.
      const originY = content.parentElement!.getBoundingClientRect().top + content.offsetTop;
      const height = Math.min(content.getBoundingClientRect().height, maxHeight);
      const offsetY = Math.max(top, Math.min(originY, bottom - height)) - originY;
      const scrollable = content.scrollHeight > content.clientHeight;
      setLayout((previous) => previous.offsetY === offsetY && previous.maxHeight === maxHeight && previous.scrollable === scrollable
        ? previous : { scrollable, offsetY, maxHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    if (clip) observer.observe(clip);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [active, label, data]);

  const t = Number(label);
  if (!active || !data || label == null || !Number.isFinite(t)) return null;
  const date = new Date(t).toISOString().slice(0, 10);
  const street = data.streetSeries.find((point) => point.bucket === date);
  const sales = data.addressSales.filter((sale) => sale.soldAt === date);
  if (!street && sales.length === 0) return null;
  return (
    <div ref={contentRef} role="tooltip" tabIndex={0} aria-label={`Försäljningar ${date}`}
      style={{
        pointerEvents: layout.scrollable ? "auto" : undefined,
        transform: layout.offsetY ? `translateY(${layout.offsetY}px)` : undefined,
        maxHeight: layout.maxHeight == null ? undefined : `min(192px,40dvh,${layout.maxHeight}px)`,
      }}
      onMouseMove={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation(); }}
      className="max-h-[min(192px,40dvh)] overflow-y-auto overscroll-contain focus:outline-2 focus:outline-blue-700 max-w-[min(260px,70vw)] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 shadow-sm">
      <p className="font-medium text-zinc-900">{date}</p>
      {street && <div className="mt-2">
        <p>Gatans median: {SEK.format(street.medianPricePerSqm)} kr/m²</p>
        <p>Medel: {SEK.format(street.meanPricePerSqm)} kr/m²</p>
        <p>{formatSales(street.count)}{street.count < 3 && " · få affärer"}</p>
      </div>}
      {sales.map((sale, index) => <div key={index} className="mt-2">
        <p>Försäljning: {SEK.format(sale.pricePerSqmSek)} kr/m²</p>
        <p>{formatSales(1)}</p>
      </div>)}
    </div>
  );
}
