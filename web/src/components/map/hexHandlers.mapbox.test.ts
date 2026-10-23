// @vitest-environment jsdom
// Drives the real mapbox-gl Map.prototype.on/off (no WebGL: everything else is
// stubbed). The first test documents the hazard (layer-scoped listeners stack
// when registered again on every layer re-add); it is not a run of the old
// component code. The other two test createHexHandlers.
import { describe, expect, it } from "vitest";
import { createHexHandlers, type HexMapLike, type HexPopupLike } from "./hexHandlers";

const mapboxgl = (await import("mapbox-gl")).default as any; // eslint-disable-line @typescript-eslint/no-explicit-any

/* eslint-disable @typescript-eslint/no-explicit-any */
function stubMap(layers: Set<string>) {
  const m: any = Object.create(mapboxgl.Map.prototype);
  m._listeners = {};
  m._oneTimeListeners = {};
  m.getLayer = (id: string) => (layers.has(id) ? { id } : undefined);
  m.queryRenderedFeatures = (_p: unknown, o: { layers: string[] }) =>
    o.layers.includes("hex-fill") ? [{ properties: { count: 3 } }] : [];
  m.getCanvas = () => ({ style: { cursor: "" } });
  m.getCanvasContainer = () => document.createElement("div");
  m.unproject = () => ({ lng: 0, lat: 0 });
  return m;
}
const move = (m: any) =>
  m.fire({ type: "mousemove", point: { x: 0, y: 0 }, originalEvent: new MouseEvent("mousemove") });
/* eslint-enable @typescript-eslint/no-explicit-any */

function countingPopup() {
  const counter = { shown: 0 };
  let open = false;
  const popup: HexPopupLike = {
    setLngLat: () => popup,
    setDOMContent: () => {
      counter.shown++;
      return popup;
    },
    addTo: () => {
      open = true;
      return popup;
    },
    isOpen: () => open,
    remove: () => {
      open = false;
      return popup;
    },
  };
  return { popup, counter };
}

const SWITCHES = 3;

describe("hex handlers against the real mapbox-gl event system", () => {
  it("hazard: registering again on every layer re-add stacks one listener set per registration", () => {
    const layers = new Set<string>();
    const map = stubMap(layers);
    const { popup, counter } = countingPopup();
    for (let i = 0; i < SWITCHES; i++) {
      layers.add("hex-fill"); // layer re-added
      // Old code created fresh closures and called map.on again here.
      createHexHandlers(map as HexMapLike, "hex-fill", popup, () => 365).ensure();
      layers.delete("hex-fill"); // mode switched back to price
    }
    layers.add("hex-fill");
    move(map);
    expect(counter.shown).toBe(SWITCHES);
  });

  it("registering once fires the handler once however often the layers are re-added", () => {
    const layers = new Set<string>();
    const map = stubMap(layers);
    const { popup, counter } = countingPopup();
    const handlers = createHexHandlers(map as HexMapLike, "hex-fill", popup, () => 365);
    for (let i = 0; i < SWITCHES; i++) {
      layers.add("hex-fill");
      handlers.ensure();
      layers.delete("hex-fill");
      handlers.release();
    }
    layers.add("hex-fill");
    move(map);
    expect(counter.shown).toBe(1);
  });

  it("dispose leaves no listeners behind", () => {
    const layers = new Set(["hex-fill"]);
    const map = stubMap(layers);
    const { popup, counter } = countingPopup();
    const handlers = createHexHandlers(map as HexMapLike, "hex-fill", popup, () => 365);
    handlers.ensure();
    handlers.dispose();
    move(map);
    expect(counter.shown).toBe(0);
  });
});
