"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { Granularity } from "@/lib/aggregations";
import { foldForSearch } from "@/lib/text";
import { comparisonHref, type ComparisonOption } from "./comparison";

export function CompareBuilder({ options, selected, granularity }: {
  options: ComparisonOption[];
  selected: ComparisonOption[];
  granularity: Granularity;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ids = selected.map((s) => s.id);
  const matches = options.filter((o) => !ids.includes(o.id) && foldForSearch(o.name).includes(foldForSearch(query))).slice(0, 30);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId, open]);
  const add = (option: ComparisonOption) => {
    setQuery("");
    setActive(-1);
    setOpen(false);
    router.push(comparisonHref([...ids, option.id], granularity), { scroll: false });
  };
  return (
    <section aria-label="Bygg jämförelse" className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="relative max-w-xl">
        <label htmlFor={`${listId}-input`} className="mb-2 block text-sm font-medium text-zinc-900">Lägg till gata eller stadsdel</label>
        <input id={`${listId}-input`} role="combobox" aria-autocomplete="list" aria-expanded={open}
          aria-controls={listId} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          value={query} placeholder="Sök till exempel Götgatan eller Vasastan"
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          onChange={(e) => { setQuery(e.target.value); setActive(-1); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") { setOpen(false); setActive(-1); }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault(); setOpen(true);
              setActive((i) => matches.length ? (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : -1);
            }
            if (e.key === "Enter" && open && matches.length) { e.preventDefault(); add(matches[active >= 0 ? active : 0]); }
          }}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-2 focus:outline-zinc-900" />
        {open && <ul id={listId} role="listbox" aria-label="Gator och stadsdelar" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
          {matches.map((option, i) => <li key={option.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()} onClick={() => add(option)}
            className={`cursor-pointer px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-100 ${i === active ? "bg-zinc-100" : ""}`}>
            {option.name}
          </li>)}
          {!matches.length && <li role="presentation" className="px-3 py-2 text-sm text-zinc-600">Inga fler matchande serier.</li>}
        </ul>}
      </div>
      <div role="group" aria-label="Valda serier" className="flex flex-wrap gap-2">
        {selected.map((s) => <Link key={s.id} href={comparisonHref(ids.filter((id) => id !== s.id), granularity)} scroll={false}
          aria-label={`Ta bort ${s.name}`} className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}<span aria-hidden>×</span>
        </Link>)}
        {!selected.length && <p className="text-sm text-zinc-600">Välj en gata eller stadsdel för att börja jämföra.</p>}
      </div>
    </section>
  );
}
