const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Tabbable descendants of `container`, in DOM order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute("hidden")
  );
}

/**
 * Keep Tab / Shift+Tab inside `container`. Call from a keydown handler; it
 * prevents the default only when it moves focus itself. Focus that already
 * escaped the container is pulled back in.
 */
export function trapTab(e: KeyboardEvent, container: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = focusableWithin(container);
  if (items.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = active ? container.contains(active) : false;
  if (e.shiftKey) {
    if (!inside || active === first || active === container) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Lock page scrolling (body overflow) and return the function that restores it. */
export function lockBodyScroll(): () => void {
  const previous = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return () => {
    document.body.style.overflow = previous;
  };
}
