import type { ReactNode } from "react";

/** Native disclosure keeps exact chart values available to keyboard and screen-reader users. */
export function ChartDataTable({ title, headers, rows }: { title: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-3 text-sm text-zinc-700">
      <summary className="w-fit cursor-pointer rounded py-1 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">Visa tabell: {title}</summary>
      <div role="region" aria-label={`${title} (scrolla i sidled)`} tabIndex={0} className="mt-2 max-h-80 overflow-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{title}</caption>
          <thead className="sticky top-0 bg-zinc-50 text-zinc-700"><tr>{headers.map((header) => <th key={header} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{header}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100">{rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j} className="whitespace-nowrap px-3 py-2 tabular-nums">{value}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
