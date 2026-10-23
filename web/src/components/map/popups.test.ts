// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildHexPopup, buildPricePopup } from "./popups";

const base = { pricePerSqm: 123_456, soldAt: "2025-06-02", sources: "hemnet,booli" };

const PAYLOADS = [
  "<img src=x onerror=alert(1)>Gatan 1",
  '"><script>alert(1)</script>',
  "</strong><iframe src=javascript:alert(1)></iframe>",
];

describe("regression proof for F3", () => {
  // The pre-fix popup: Mapbox's setHTML parses the string as HTML.
  const oldTemplate = (address: string) =>
    `<div><strong>${address}</strong></div>`;

  it("the old setHTML-style template materialises the injected element", () => {
    const host = document.createElement("div");
    host.innerHTML = oldTemplate(PAYLOADS[0]);
    expect(host.querySelector("img")?.getAttribute("onerror")).toBe("alert(1)");
  });

  it("the DOM builder does not", () => {
    const host = document.createElement("div");
    host.appendChild(buildPricePopup({ ...base, address: PAYLOADS[0] }));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[onerror]")).toBeNull();
  });
});

describe("buildPricePopup", () => {
  it("joins several sources with non-breaking spaces so the chip cannot wrap at the plus", () => {
    const el = buildPricePopup({ ...base, address: "Gatan 1" });
    expect(el.textContent).toContain("H + B");
  });

  it("renders the address, price, date and source chips", () => {
    const el = buildPricePopup({ ...base, address: "Karlavägen 10" });
    expect(el.textContent).toContain("Karlavägen 10");
    expect(el.textContent).toContain("123 456 kr/m²");
    expect(el.textContent).toContain("2025-06-02");
    expect(el.textContent).toContain("H");
    expect(el.textContent).toContain("B");
  });

  for (const payload of PAYLOADS) {
    it(`renders a malicious address literally: ${payload}`, () => {
      const el = buildPricePopup({ ...base, address: payload });
      expect(el.querySelector("img, script, iframe")).toBeNull();
      expect(el.querySelector("strong")?.textContent).toBe(payload);
    });

    it(`renders a malicious soldAt literally: ${payload}`, () => {
      const el = buildPricePopup({ ...base, address: "Gatan 1", soldAt: payload });
      expect(el.querySelector("img, script, iframe")).toBeNull();
      expect(el.textContent).toContain(payload);
    });
  }

  it("renders a malicious source value literally and tolerates empty sources", () => {
    const el = buildPricePopup({ ...base, address: "Gatan 1", sources: "<img src=x onerror=1>,,booli" });
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("B");
    expect(buildPricePopup({ ...base, address: "Gatan 1", sources: "" }).textContent).toContain("Gatan 1");
  });
});

describe("buildHexPopup", () => {
  it("uses singular and plural", () => {
    expect(buildHexPopup(1, "hela perioden").textContent).toContain("1 försäljning");
    expect(buildHexPopup(1, "hela perioden").textContent).not.toContain("försäljningar");
    expect(buildHexPopup(7, "senaste 3 månader").textContent).toContain("7 försäljningar");
  });
});
