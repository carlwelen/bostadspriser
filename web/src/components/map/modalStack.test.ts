// @vitest-environment jsdom
// The street search (Cmd/Ctrl-K) can open on top of the address drawer; only
// the topmost modal may react to Esc and Tab, and the scroll lock is shared.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressDrawer, type AddressSelection } from "../AddressDrawer";
import { StreetSearch } from "../StreetSearch";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const selection: AddressSelection = {
  district: "ostermalm",
  street: "Karlavägen",
  houseNumber: "10",
  address: "Karlavägen 10",
  pricePerSqm: 100_000,
  soldAt: "2025-06-02",
  sources: ["hemnet"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

async function mountBoth(initialOnClose = vi.fn()) {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // everything stays loading
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (onClose: () => void) =>
    act(async () => {
      root.render(
        createElement("div", null, createElement(StreetSearch), createElement(AddressDrawer, { selection, onClose }))
      );
    });
  await render(initialOnClose);
  return { host, root, render, onClose: initialOnClose };
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });

const searchDialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Sök gata"]');
const drawerDialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby]');

describe("search opened over the address drawer", () => {
  it("Esc closes only the search", async () => {
    const { root, onClose } = await mountBoth();
    await key("k", { metaKey: true });
    expect(searchDialog()).not.toBeNull();
    await key("Escape");
    expect(searchDialog()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(drawerDialog()).not.toBeNull();
    // The next Esc belongs to the drawer.
    await key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("Tab inside the search stays in the search", async () => {
    const { root } = await mountBoth();
    await key("k", { metaKey: true });
    const dialog = searchDialog()!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 4; i++) {
      await key("Tab");
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await key("Tab", { shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => root.unmount());
  });

  it("paints above the drawer", async () => {
    const { root } = await mountBoth();
    await key("k", { metaKey: true });
    const z = (el: Element) => Number(/z-\[?(\d+)\]?/.exec(el.closest(".fixed")!.className)![1]);
    expect(z(searchDialog()!)).toBeGreaterThan(z(drawerDialog()!));
    await act(async () => root.unmount());
  });

  it("keeps the page scroll locked until the last modal closes", async () => {
    const { root, render } = await mountBoth();
    expect(document.body.style.overflow).toBe("hidden");
    await key("k", { metaKey: true });
    await key("Escape"); // search closes, drawer still open
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => root.render(createElement("div")));
    expect(document.body.style.overflow).toBe("");
    void render;
  });

  it("returns focus into the drawer when the search closes", async () => {
    const { root } = await mountBoth();
    const tab = [...drawerDialog()!.querySelectorAll<HTMLElement>('[role="tab"]')][1];
    tab.focus();
    await key("k", { metaKey: true });
    await key("Escape");
    expect(document.activeElement).toBe(tab);
    await act(async () => root.unmount());
  });
});

describe("drawer focus stability", () => {
  it("re-rendering with a new onClose keeps focus where it was", async () => {
    const { root, render } = await mountBoth();
    const tab = [...drawerDialog()!.querySelectorAll<HTMLElement>('[role="tab"]')][1];
    tab.focus();
    expect(document.activeElement).toBe(tab);
    await render(vi.fn());
    expect(document.activeElement).toBe(tab);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => root.unmount());
  });
});
