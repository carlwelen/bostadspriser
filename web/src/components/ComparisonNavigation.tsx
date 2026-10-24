"use client";

import { createContext, useContext, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const Navigation = createContext<{ pending: boolean; navigate: (href: string) => void } | null>(null);

/** Serialize every comparison mutation, including links rendered on the server. */
export function ComparisonNavigation({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const locked = useRef(false);
  useEffect(() => { if (!pending) locked.current = false; }, [pending]);
  const navigate = (href: string) => {
    if (locked.current) return;
    locked.current = true;
    startTransition(() => router.push(href, { scroll: false }));
  };
  return (
    <Navigation.Provider value={{ pending, navigate }}>
      <div aria-busy={pending} onClickCapture={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = (event.target as Element).closest("a");
        if (!anchor || anchor.target === "_blank") return;
        const url = new URL(anchor.href);
        if (url.origin !== window.location.origin || url.pathname !== "/compare") return;
        event.preventDefault();
        event.stopPropagation();
        navigate(`${url.pathname}${url.search}`);
      }}>
        {children}
        {pending && <p role="status" className="fixed bottom-4 right-4 z-30 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">Uppdaterar jämförelsen…</p>}
      </div>
    </Navigation.Provider>
  );
}

export function useComparisonNavigation() {
  const navigation = useContext(Navigation);
  if (!navigation) throw new Error("Comparison controls require ComparisonNavigation");
  return navigation;
}
