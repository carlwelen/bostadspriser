// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createHexHandlers, type HexMapLike, type HexPopupLike } from "./hexHandlers";

type Fn = (e: unknown) => void;

/** A map that records listeners the way Mapbox does for layer-delegated events. */
function fakeMap() {
  const listeners = new Map<string, Set<Fn>>();
  const calls = { on: 0, off: 0 };
  const key = (type: string, layer: string) => `${type}:${layer}`;
  const map: HexMapLike = {
    on(type, layer, fn) {
      calls.on++;
      const k = key(type, layer);
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k)!.add(fn as Fn);
    },
    off(type, layer, fn) {
      calls.off++;
      listeners.get(key(type, layer))?.delete(fn as Fn);
    },
    getCanvas: () => ({ style: { cursor: "" } }) as HTMLCanvasElement,
  };
  const emit = (type: string, layer: string, e: unknown) =>
    listeners.get(key(type, layer))?.forEach((fn) => fn(e));
  const total = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
  return { map, calls, emit, total };
}

function fakePopup() {
  const log: string[] = [];
  let open = false;
  const popup: HexPopupLike = {
    setLngLat() {
      return popup;
    },
    setDOMContent(node) {
      log.push(node.textContent ?? "");
      return popup;
    },
    addTo() {
      open = true;
      return popup;
    },
    isOpen: () => open,
    remove() {
      open = false;
      return popup;
    },
  };
  return { popup, log, isOpen: () => open };
}

const hover = (count: number) => ({ features: [{ properties: { count } }], lngLat: { lng: 18, lat: 59 } });

describe("createHexHandlers", () => {
  it("registers each handler once however often the hex layers are re-added", () => {
    const { map, calls, total } = fakeMap();
    const handlers = createHexHandlers(map, "hex-fill", fakePopup().popup, () => 365);
    // price -> frequency -> price -> frequency ... : ensure() on every re-add.
    for (let i = 0; i < 5; i++) {
      handlers.ensure();
      handlers.release();
    }
    expect(calls.on).toBe(3);
    expect(calls.off).toBe(0);
    expect(total()).toBe(3);
  });

  it("shows exactly one popup per hover after repeated mode switches", () => {
    const { map, emit } = fakeMap();
    const { popup, log } = fakePopup();
    const handlers = createHexHandlers(map, "hex-fill", popup, () => 365);
    for (let i = 0; i < 4; i++) {
      handlers.ensure();
      handlers.release();
    }
    handlers.ensure();
    emit("mouseenter", "hex-fill", hover(7));
    expect(log).toEqual(["7 försäljningar" + "senaste 12 månader"]);
  });

  it("closes the popup and resets the cursor on release", () => {
    const { map, emit } = fakeMap();
    const p = fakePopup();
    const handlers = createHexHandlers(map, "hex-fill", p.popup, () => undefined);
    handlers.ensure();
    emit("mouseenter", "hex-fill", hover(1));
    expect(p.isOpen()).toBe(true);
    handlers.release();
    expect(p.isOpen()).toBe(false);
  });

  it("dispose removes every listener, and ensure afterwards registers again", () => {
    const { map, calls, total } = fakeMap();
    const handlers = createHexHandlers(map, "hex-fill", fakePopup().popup, () => 30);
    handlers.ensure();
    handlers.dispose();
    expect(calls.off).toBe(3);
    expect(total()).toBe(0);
    handlers.dispose(); // idempotent
    expect(calls.off).toBe(3);
    handlers.ensure();
    expect(total()).toBe(3);
  });

  it("reads the period label at hover time", () => {
    const { map, emit } = fakeMap();
    const { popup, log } = fakePopup();
    let days: number | undefined = 30;
    createHexHandlers(map, "hex-fill", popup, () => days).ensure();
    emit("mouseenter", "hex-fill", hover(2));
    days = undefined;
    emit("mouseenter", "hex-fill", hover(2));
    expect(log).toEqual(["2 försäljningarsenaste 30 dagar", "2 försäljningarhela perioden"]);
  });
});
