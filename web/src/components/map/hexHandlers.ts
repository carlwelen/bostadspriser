import { buildHexPopup } from "./popups";

export function sinceDaysToLabel(days: number): string {
  if (days <= 30) return "senaste 30 dagar";
  if (days <= 95) return "senaste 3 månader";
  if (days <= 380) return "senaste 12 månader";
  return `senaste ${days} dagar`;
}

type HexEvent = {
  features?: Array<{ properties?: { count?: number } | null }>;
  lngLat: unknown;
};
type HexListener = (e: HexEvent) => void;

// The slice of mapboxgl.Map / mapboxgl.Popup used here, so tests can fake them.
export type HexMapLike = {
  on(type: string, layerId: string, listener: HexListener): unknown;
  off(type: string, layerId: string, listener: HexListener): unknown;
  getCanvas(): HTMLCanvasElement;
};
export type HexPopupLike = {
  setLngLat(lngLat: never): HexPopupLike;
  setDOMContent(node: HTMLElement): HexPopupLike;
  addTo(map: never): HexPopupLike;
  isOpen(): boolean;
  remove(): HexPopupLike;
};

/**
 * Hover handlers for the hex pillars. Layer-scoped Mapbox listeners are keyed
 * by layer id and survive removeLayer/addLayer, so they are registered once per
 * map (`ensure` is idempotent) instead of on every layer re-add. Otherwise each
 * price -> frequency -> price switch would stack another set of handlers.
 */
export function createHexHandlers(
  map: HexMapLike,
  layerId: string,
  popup: HexPopupLike,
  getSinceDays: () => number | undefined
) {
  const onEnter: HexListener = (e) => {
    map.getCanvas().style.cursor = "pointer";
    const count = e.features?.[0]?.properties?.count;
    if (typeof count !== "number") return;
    const days = getSinceDays();
    const period = days ? sinceDaysToLabel(days) : "hela perioden";
    popup.setLngLat(e.lngLat as never).setDOMContent(buildHexPopup(count, period)).addTo(map as never);
  };
  // Reposition the popup as the cursor moves over the hex.
  const onMove: HexListener = (e) => {
    if (popup.isOpen()) popup.setLngLat(e.lngLat as never);
  };
  const onLeave: HexListener = () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
  };
  const bindings: Array<[string, HexListener]> = [
    ["mouseenter", onEnter],
    ["mousemove", onMove],
    ["mouseleave", onLeave],
  ];

  let registered = false;
  return {
    /** Register the handlers unless they already are. */
    ensure() {
      if (registered) return;
      for (const [type, fn] of bindings) map.on(type, layerId, fn);
      registered = true;
    },
    /** The layers went away: mouseleave won't fire, so close the popup and reset the cursor. */
    release() {
      onLeave({ lngLat: null });
    },
    /** Remove the listeners (map teardown). */
    dispose() {
      if (!registered) return;
      for (const [type, fn] of bindings) map.off(type, layerId, fn);
      registered = false;
      onLeave({ lngLat: null });
    },
  };
}
