// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MobileNav } from "./MobileNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/street/ostermalm/karlavagen" }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("preserves the search opener when selection happens with the menu already closed", async () => {
  const host = document.createElement("div");
  const opener = document.createElement("button");
  document.body.append(opener, host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MobileNav crumbs={[]} openSearch={() => {}} selectionKey={0} />));
    opener.focus();
    await act(async () => root.render(<MobileNav crumbs={[]} openSearch={() => {}} selectionKey={1} />));
    expect(document.activeElement).toBe(opener);
  } finally { await act(async () => root.unmount()); host.remove(); opener.remove(); }
});

it("closes an open menu after selection, focuses Meny and allows reopening", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MobileNav crumbs={[]} openSearch={() => {}} selectionKey={0} />));
    const toggle = host.querySelector("button")!;
    await act(async () => toggle.click());
    await act(async () => root.render(<MobileNav crumbs={[]} openSearch={() => {}} selectionKey={1} />));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
