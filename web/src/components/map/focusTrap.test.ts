// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusableWithin, lockBodyScroll, registerModal, trapTab } from "./focusTrap";

afterEach(() => {
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

function setup() {
  document.body.innerHTML = `
    <button id="outside">outside</button>
    <div id="box" tabindex="-1">
      <button id="a">a</button>
      <input id="b" />
      <button id="skip" disabled>x</button>
      <a id="c" href="/x">c</a>
      <a id="neg" href="/y" tabindex="-1">neg</a>
    </div>`;
  return document.getElementById("box")!;
}

const tab = (shiftKey = false) =>
  new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true });

describe("focusableWithin", () => {
  it("lists tabbable elements only, in order", () => {
    expect(focusableWithin(setup()).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("trapTab", () => {
  it("wraps from the last element to the first and back", () => {
    const box = setup();
    document.getElementById("c")!.focus();
    const fwd = tab();
    trapTab(fwd, box);
    expect(fwd.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("a");

    const back = tab(true);
    trapTab(back, box);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("c");
  });

  it("leaves Tab alone in the middle of the container", () => {
    const box = setup();
    document.getElementById("b")!.focus();
    const e = tab();
    trapTab(e, box);
    expect(e.defaultPrevented).toBe(false);
  });

  it("pulls escaped focus back in", () => {
    const box = setup();
    document.getElementById("outside")!.focus();
    trapTab(tab(), box);
    expect(document.activeElement?.id).toBe("a");
    document.getElementById("outside")!.focus();
    trapTab(tab(true), box);
    expect(document.activeElement?.id).toBe("c");
  });

  it("Shift+Tab from the container itself goes to the last element", () => {
    const box = setup();
    box.focus();
    trapTab(tab(true), box);
    expect(document.activeElement?.id).toBe("c");
  });

  it("keeps focus on the container when nothing inside is tabbable", () => {
    document.body.innerHTML = '<div id="box" tabindex="-1"><span>text</span></div>';
    const box = document.getElementById("box")!;
    const e = tab();
    trapTab(e, box);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(box);
  });

  it("ignores other keys", () => {
    const box = setup();
    const e = new KeyboardEvent("keydown", { key: "a", cancelable: true });
    trapTab(e, box);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe("registerModal", () => {
  const press = (key: string) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));

  it("sends Esc only to the most recently opened modal", () => {
    const box = setup();
    const lower = vi.fn();
    const upper = vi.fn();
    const offLower = registerModal(() => box, lower);
    const offUpper = registerModal(() => box, upper);
    press("Escape");
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    offUpper();
    press("Escape");
    expect(lower).toHaveBeenCalledTimes(1);
    offLower();
    press("Escape");
    expect(lower).toHaveBeenCalledTimes(1); // listener is gone
  });

  it("closing a lower modal first leaves the upper one in charge", () => {
    const box = setup();
    const lower = vi.fn();
    const upper = vi.fn();
    const offLower = registerModal(() => box, lower);
    const offUpper = registerModal(() => box, upper);
    offLower();
    press("Escape");
    expect(upper).toHaveBeenCalledTimes(1);
    offUpper();
  });

  it("holds one scroll lock until the last modal is gone, in any order", () => {
    document.body.style.overflow = "scroll";
    const box = setup();
    const a = registerModal(() => box, () => {});
    const b = registerModal(() => box, () => {});
    a();
    expect(document.body.style.overflow).toBe("hidden");
    b();
    expect(document.body.style.overflow).toBe("scroll");
    a(); // idempotent
    expect(document.body.style.overflow).toBe("scroll");
  });
});

describe("lockBodyScroll", () => {
  it("locks and restores the previous value", () => {
    document.body.style.overflow = "scroll";
    const unlock = lockBodyScroll();
    expect(document.body.style.overflow).toBe("hidden");
    unlock();
    expect(document.body.style.overflow).toBe("scroll");
  });
});
