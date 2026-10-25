// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, expect, it, vi } from "vitest";

vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));
vi.mock("./map/HeatmapMap.module.css", () => ({ default: {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Layer = { id: string; layout?: Record<string, unknown> };
type MockMap = {
  layers: Map<string, Layer>;
  listeners: Map<string, () => void>;
  easeTo: ReturnType<typeof vi.fn>;
};
const state = vi.hoisted(() => ({
  maps: [] as MockMap[],
  requests: [] as Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }>,
}));
vi.mock("mapbox-gl", () => ({ default: {
  Map: class {
    layers = new Map<string, Layer>();
    sources = new Map<string, { setData: () => void }>();
    listeners = new Map<string, () => void>();
    easeTo = vi.fn();
    constructor() { state.maps.push(this); }
    on(event: string, ...args: unknown[]) { this.listeners.set(event, args.at(-1) as () => void); }
    off() {}
    addControl() {}
    remove() {}
    setPaintProperty() {}
    getCanvas() { return { style: {} }; }
    getLayer(id: string) { return this.layers.get(id); }
    addLayer(layer: Layer) { this.layers.set(layer.id, layer); }
    removeLayer(id: string) { this.layers.delete(id); }
    getSource(id: string) { return this.sources.get(id); }
    addSource(id: string) { this.sources.set(id, { setData() {} }); }
    removeSource(id: string) { this.sources.delete(id); }
    setLayoutProperty(id: string, key: string, value: unknown) {
      const layer = this.layers.get(id)!;
      layer.layout ??= {};
      layer.layout[key] = value;
    }
  },
  NavigationControl: class {},
  Popup: class { remove() {} },
} }));
vi.mock("./map/fetchJson", () => ({
  fetchJson: () => new Promise((resolve, reject) => { state.requests.push({ resolve, reject }); }),
}));
vi.mock("./AddressDrawer", () => ({ AddressDrawer: () => null }));
vi.mock("./map/hexHandlers", () => ({ createHexHandlers: () => ({ ensure() {}, release() {}, dispose() {} }) }));

vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "offline-test-no-network");
const { HeatmapMap } = await import("./HeatmapMap");
type Props = ComponentProps<typeof HeatmapMap>;
const defaults: Props = { districts: ["ostermalm"], mode: "price", showHeatmap: true };
const points = {
  type: "FeatureCollection", truncated: false,
  features: [{
    type: "Feature", geometry: { type: "Point", coordinates: [18.07, 59.33] },
    properties: {
      street: "Testgatan", houseNumber: "1", address: "Testgatan 1", soldAt: "2026-05-01",
      pricePerSqm: 100000, district: "ostermalm", sources: "hemnet",
    },
  }],
};

async function mounted(props: Partial<Props>, check: (controls: {
  map: MockMap; host: HTMLDivElement; render: (next: Partial<Props>) => Promise<void>;
}) => Promise<void>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current = { ...defaults, ...props };
  const render = async (next: Partial<Props>) => {
    current = { ...current, ...next };
    await act(async () => root.render(<HeatmapMap {...current} />));
  };
  try {
    await render({});
    await check({ map: state.maps[0], host, render });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}
const loadStyle = (map: MockMap) => act(async () => map.listeners.get("load")!());
const finishFetch = () => act(async () => state.requests.at(-1)!.resolve(structuredClone(points)));
function expectLayers(map: MockMap, mode: Props["mode"], visible: boolean) {
  expect([...map.layers.keys()].sort()).toEqual(mode === "price"
    ? ["price-points"] : ["hex-fill", "hex-outline", "price-points"]);
  for (const layer of map.layers.values()) {
    const isActiveMode = layer.id === "price-points" ? mode === "price" : mode === "frequency";
    expect(layer.layout?.visibility ?? "visible", layer.id).toBe(visible && isActiveMode ? "visible" : "none");
  }
}
afterEach(() => {
  state.maps.length = 0;
  state.requests.length = 0;
  vi.restoreAllMocks();
});
afterAll(() => vi.unstubAllEnvs());

const initialCases = (["price", "frequency"] as const).flatMap(mode =>
  [false, true].flatMap(showHeatmap => [false, true].map(styleFirst => ({ mode, showHeatmap, styleFirst }))));
it.each(initialCases)("applies initial controls after both load orders: %j", async ({ mode, showHeatmap, styleFirst }) => {
  await mounted({ mode, showHeatmap }, async ({ map }) => {
    if (styleFirst) {
      await loadStyle(map);
      const cameraMoves = map.easeTo.mock.calls.length;
      await finishFetch();
      expect(map.easeTo).toHaveBeenCalledTimes(cameraMoves);
    } else {
      await finishFetch();
      expect(map.layers.size).toBe(0);
      await loadStyle(map);
    }
    expectLayers(map, mode, showHeatmap);
  });
});
it("uses controls changed while data is pending and restores the selected overlay", async () => {
  await mounted({}, async ({ map, render }) => {
    await loadStyle(map);
    await render({ mode: "frequency", showHeatmap: false });
    await finishFetch();
    expectLayers(map, "frequency", false);
    await render({ showHeatmap: true });
    expectLayers(map, "frequency", true);
    await render({ mode: "price" });
    expectLayers(map, "price", true);
    await render({ showHeatmap: false });
    expectLayers(map, "price", false);
  });
});
it("keeps rebuilt hexes hidden after deselecting and reselecting districts without moving the camera", async () => {
  await mounted({ mode: "frequency", showHeatmap: false }, async ({ map, render }) => {
    await loadStyle(map);
    await finishFetch();
    expectLayers(map, "frequency", false);
    const cameraMoves = map.easeTo.mock.calls.length;
    await render({ districts: [] });
    expect([...map.layers.keys()]).toEqual(["price-points"]);
    await render({ districts: ["ostermalm"] });
    await finishFetch();
    expectLayers(map, "frequency", false);
    expect(map.easeTo).toHaveBeenCalledTimes(cameraMoves);
  });
});
it("keeps rebuilt hexes hidden after a failed filter request and retry without moving the camera", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await mounted({ mode: "frequency", showHeatmap: false }, async ({ map, host, render }) => {
    await loadStyle(map);
    await finishFetch();
    const cameraMoves = map.easeTo.mock.calls.length;
    await render({ filters: { sinceDays: 30 } });
    await act(async () => state.requests.at(-1)!.reject(new Error("offline fixture failure")));
    expect([...map.layers.keys()]).toEqual(["price-points"]);
    const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Försök igen");
    expect(retry).toBeDefined();
    const requestCount = state.requests.length;
    await act(async () => retry!.click());
    expect(state.requests).toHaveLength(requestCount + 1);
    await finishFetch();
    expectLayers(map, "frequency", false);
    expect(map.easeTo).toHaveBeenCalledTimes(cameraMoves);
  });
});
