// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressDrawer, type AddressSelection } from "./AddressDrawer";
import { focusableWithin } from "./map/focusTrap";
import slugVectors from "../../../shared/slug-vectors.json";

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

async function mountFailingThenPending() {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (++calls === 1) return { ok: false, status: 500, json: async () => ({ error: "x" }) };
      return new Promise(() => {}); // the retry stays pending
    })
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(AddressDrawer, { selection, onClose: () => {} }));
  });
  return { host, root, calls: () => calls };
}

// F21: dialog semantics and keyboard behaviour. The fetch never settles, so the
// drawer stays in its loading state (no charts needed).
async function mountPending(onClose = () => {}) {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const trigger = document.createElement("button");
  trigger.textContent = "trigger";
  document.body.appendChild(trigger);
  trigger.focus();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (sel: AddressSelection | null) =>
    act(async () => {
      root.render(createElement(AddressDrawer, { selection: sel, onClose }));
    });
  await render(selection);
  return { trigger, host, root, render };
}
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });

describe("AddressDrawer stable street links (B23)", () => {
  it.each(slugVectors.slug)("keeps the shared URL for $input", async ({ input, expected }) => {
    const { host, root, render } = await mountPending();
    await render({ ...selection, street: input });
    expect(host.querySelector('a[href^="/street/"]')?.getAttribute("href"))
      .toBe(`/street/ostermalm/${expected}/10`);
    await act(async () => root.unmount());
  });
});

describe("AddressDrawer dialog behaviour (F21)", () => {
  it("is a modal dialog labelled by its heading", async () => {
    const { host, root } = await mountPending();
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const heading = host.querySelector(`#${dialog.getAttribute("aria-labelledby")}`);
    expect(heading?.textContent).toBe("Karlavägen 10");
    await act(async () => root.unmount());
  });

  it("moves focus into the dialog when it opens", async () => {
    const { host, root } = await mountPending();
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
    await act(async () => root.unmount());
  });

  it("returns focus to the element that had it before, when it closes", async () => {
    const { trigger, render, root } = await mountPending();
    expect(document.activeElement).not.toBe(trigger);
    await render(null);
    expect(document.activeElement).toBe(trigger);
    await act(async () => root.unmount());
  });

  it("Escape calls onClose", async () => {
    const onClose = vi.fn();
    const { root } = await mountPending(onClose);
    await key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("keeps Tab inside the dialog, wrapping at both ends", async () => {
    const { host, root } = await mountPending();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const items = focusableWithin(dialog);
    expect(items.length).toBeGreaterThan(1);
    items[items.length - 1].focus();
    await key("Tab");
    expect(document.activeElement).toBe(items[0]);
    await key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
    await act(async () => root.unmount());
  });

  it("locks page scrolling while open and restores it on close", async () => {
    const { render, root } = await mountPending();
    expect(document.body.style.overflow).toBe("hidden");
    await render(null);
    expect(document.body.style.overflow).toBe("");
    await act(async () => root.unmount());
  });
});

describe("AddressDrawer retry (F33)", () => {
  it("offers a type=button retry after an error", async () => {
    const { host, root } = await mountFailingThenPending();
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Försök igen");
    expect(retry).toBeDefined();
    expect(retry!.getAttribute("type")).toBe("button");
    await act(async () => root.unmount());
  });

  it("refetches on click and keeps focus inside the drawer instead of dropping it to <body>", async () => {
    const { host, root, calls } = await mountFailingThenPending();
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Försök igen")!;
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await act(async () => retry.click());

    expect(calls()).toBe(2);
    expect(host.textContent).toContain("Laddar…");
    // The retry button is gone (loading state), focus moved to the dialog panel.
    expect(host.textContent).not.toContain("Försök igen");
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(document.activeElement).toBe(dialog);
    await act(async () => root.unmount());
  });
});

describe("AddressDrawer period filter semantics (F21)", () => {
  it("uses pressed buttons in a group, with native keyboard focus order", async () => {
    const { host, root } = await mountPending();
    try {
      const group = host.querySelector('[role="group"][aria-label="Tidsperiod"]');
      expect(group).not.toBeNull();
      expect(host.querySelector('[role="tablist"]')).toBeNull();
      const buttons = Array.from(group!.querySelectorAll("button"));
      expect(buttons).toHaveLength(4);
      expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
      expect(buttons.every((button) => button.tabIndex === 0)).toBe(true);
      await act(async () => buttons[3].click());
      expect(buttons[3].getAttribute("aria-pressed")).toBe("true");
      expect(buttons[2].getAttribute("aria-pressed")).toBe("false");
    } finally { await act(async () => root.unmount()); }
  });
});
