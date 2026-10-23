// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressDrawer, type AddressSelection } from "./AddressDrawer";

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
