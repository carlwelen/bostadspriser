// Popup content for the map. Scraped strings (address, soldAt, sources) are
// untrusted, so everything is built from DOM elements and text nodes, never
// parsed as HTML. Pass the result to `Popup.setDOMContent`.

export type PricePopupProps = {
  pricePerSqm: number;
  address: string;
  soldAt: string;
  sources: string;
};

function el(
  tag: string,
  style?: string,
  text?: string,
  children: Node[] = []
): HTMLElement {
  const node = document.createElement(tag);
  if (style) node.setAttribute("style", style);
  if (text !== undefined) node.textContent = text;
  for (const c of children) node.appendChild(c);
  return node;
}

const SOURCE_COLOR: Record<string, string> = {
  hemnet: "#be123c",
  booli: "#1d4ed8",
};
const SOURCE_INITIAL: Record<string, string> = { hemnet: "H", booli: "B" };

function sourceChips(sourcesCsv: string): HTMLElement {
  const chip = el(
    "span",
    "display:inline-flex;align-items:center;gap:4px;background:#f4f4f5;padding:1px 6px;border-radius:9999px;font-size:10px"
  );
  (sourcesCsv ?? "")
    .split(",")
    .filter(Boolean)
    .forEach((s, i) => {
      // Non-breaking spaces (U+00A0) around the plus so the chip never wraps there.
      if (i > 0) chip.appendChild(el("span", "color:#a1a1aa;white-space:nowrap", " + "));
      chip.appendChild(
        el(
          "span",
          `color:${SOURCE_COLOR[s] ?? "#52525b"};font-weight:600`,
          SOURCE_INITIAL[s] ?? s[0].toUpperCase()
        )
      );
    });
  return chip;
}

export function buildPricePopup(p: PricePopupProps): HTMLElement {
  const sek = new Intl.NumberFormat("sv-SE").format(p.pricePerSqm);
  return el("div", "font:12px ui-sans-serif,system-ui;line-height:1.45;min-width:160px", undefined, [
    el("div", "display:flex;align-items:center;justify-content:space-between;gap:8px", undefined, [
      el("strong", undefined, p.address),
      sourceChips(p.sources),
    ]),
    el("div", "margin-top:2px;color:#0f172a", `${sek} kr/m²`),
    el("div", "color:#71717a", p.soldAt),
    el(
      "div",
      "margin-top:6px;color:#1d4ed8;font-weight:500;letter-spacing:0.01em",
      "Klicka för historik →"
    ),
  ]);
}

export function buildHexPopup(count: number, period: string): HTMLElement {
  const word = count === 1 ? "försäljning" : "försäljningar";
  return el("div", "font:12px ui-sans-serif,system-ui;line-height:1.4", undefined, [
    el("strong", "font-size:14px", String(count)),
    document.createTextNode(` ${word}`),
    document.createElement("br"),
    el("span", "color:#71717a", period),
  ]);
}
