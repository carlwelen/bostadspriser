import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Histogram } from "./Histogram";
import { PriceAreaScatter } from "./PriceAreaScatter";
import { PriceChart } from "./PriceChart";

// F28: server-rendering a ResponsiveContainer without an initial size makes
// Recharts warn "The width(-1) and height(-1) of chart should be greater than 0".

const point = (bucket: string, v: number) => ({
  bucket,
  medianPricePerSqm: v,
  meanPricePerSqm: v + 100,
  count: 4,
});

afterEach(() => vi.restoreAllMocks());

function renderQuietly(element: React.ReactElement) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const html = renderToString(element);
  return { html, warnings: [...warn.mock.calls, ...error.mock.calls].map((c) => String(c[0])) };
}

describe("charts render on the server without Recharts size warnings", () => {
  it("PriceChart (single series)", () => {
    const { warnings } = renderQuietly(
      <PriceChart series={[{ name: "A", points: [point("2025-01-01", 100000), point("2025-02-01", 101000)] }]} />
    );
    expect(warnings).toEqual([]);
  });

  it("PriceChart (several series)", () => {
    const { warnings } = renderQuietly(
      <PriceChart
        series={[
          { name: "A", points: [point("2025-01-01", 100000)] },
          { name: "B", points: [point("2025-01-01", 90000)] },
        ]}
      />
    );
    expect(warnings).toEqual([]);
  });

  it("Histogram", () => {
    const { warnings } = renderQuietly(
      <Histogram data={[{ bucket: 100000, count: 3 }]} bucketWidth={20000} />
    );
    expect(warnings).toEqual([]);
  });

  it("PriceAreaScatter", () => {
    const { warnings } = renderQuietly(
      <PriceAreaScatter data={[{ district: "ostermalm", areaSqm: 50, pricePerSqm: 150000, rooms: 2 }]} />
    );
    expect(warnings).toEqual([]);
  });
});
