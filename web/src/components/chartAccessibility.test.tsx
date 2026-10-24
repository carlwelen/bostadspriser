import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PriceChart } from "./PriceChart";
import { Histogram } from "./Histogram";
import { PriceAreaScatter } from "./PriceAreaScatter";

it("names the price chart and exposes exact median, mean and sample size in a data table", () => {
  const html = renderToStaticMarkup(<PriceChart series={[{ name: "Götgatan", points: [{ bucket: "2025-01-01", medianPricePerSqm: 123456, meanPricePerSqm: 125678, count: 2 }] }]} />);
  expect(html).toContain('aria-label="Prisutveckling: Götgatan"');
  expect(html).toContain("<summary");
  expect(html).toContain("Prisutveckling – diagramdata");
  expect(html).toContain("123 456");
  expect(html).toContain("125 678");
  expect(html).toContain("2 (få affärer)");
  expect(html).toContain('scope="col"');
});

it("provides a named histogram and the original bucket intervals/counts as a table", () => {
  const html = renderToStaticMarkup(<Histogram bucketWidth={20000} data={[{ bucket: 100000, count: 7 }]} />);
  expect(html).toContain('aria-label="Prisfördelning per kvadratmeter"');
  expect(html).toContain("Prisfördelning – diagramdata");
  expect(html).toContain("100 000–119 999 kr/m²");
  expect(html).toContain(">7<");
});

it("provides named scatter data without dropping repeated observations", () => {
  const point = { district: "sodermalm", areaSqm: 50, pricePerSqm: 120000, rooms: 2 };
  const html = renderToStaticMarkup(<PriceAreaScatter data={[point, point]} />);
  expect(html).toContain('aria-label="Yta och pris per kvadratmeter per stadsdel"');
  expect(html).toContain("Yta och pris – diagramdata");
  expect(html.match(/>120 000</g)).toHaveLength(2);
});
