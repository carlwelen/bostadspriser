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

let scrollLocks = 0;
let overflowBeforeLock = "";

/**
 * Lock page scrolling (body overflow). Reference-counted: the first lock saves
 * the original value, the last unlock restores it, whatever order the modals
 * close in. Returns an idempotent unlock function.
 */
export function lockBodyScroll(): () => void {
  if (scrollLocks++ === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--scrollLocks === 0) document.body.style.overflow = overflowBeforeLock;
  };
}

type ModalEntry = { container: () => HTMLElement | null; onEscape: () => void; wasInert: boolean };
const modalStack: ModalEntry[] = [];

export function isComposingKey(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

function updateModalInert() {
  const top = modalStack[modalStack.length - 1]?.container();
  for (const entry of modalStack) {
    const el = entry.container();
    el?.toggleAttribute("inert", el !== top || entry.wasInert);
  }
}

function onModalKeyDown(e: KeyboardEvent) {
  if (isComposingKey(e)) return;
  // Only the topmost modal reacts; the ones below it stay inert.
  const top = modalStack[modalStack.length - 1];
  if (!top) return;
  if (e.key === "Escape") {
    e.preventDefault();
    top.onEscape();
  } else {
    const container = top.container();
    if (container) trapTab(e, container);
  }
}

/**
 * Register an open modal: it gets Esc and Tab handling while it is the most
 * recently opened one, and holds a page scroll lock. Returns the function that
 * unregisters it (call it when the modal closes or unmounts). That function
 * returns whether it was on top, so only that modal restores focus.
 */
export function registerModal(container: () => HTMLElement | null, onEscape: () => void): () => boolean {
  const entry: ModalEntry = { container, onEscape, wasInert: container()?.hasAttribute("inert") ?? false };
  if (modalStack.length === 0) window.addEventListener("keydown", onModalKeyDown);
  modalStack.push(entry);
  updateModalInert();
  const unlock = lockBodyScroll();
  return () => {
    const i = modalStack.indexOf(entry);
    if (i < 0) return false;
    const wasTop = i === modalStack.length - 1;
    modalStack.splice(i, 1);
    container()?.toggleAttribute("inert", entry.wasInert);
    updateModalInert();
    if (modalStack.length === 0) window.removeEventListener("keydown", onModalKeyDown);
    unlock();
    return wasTop;
  };
}
