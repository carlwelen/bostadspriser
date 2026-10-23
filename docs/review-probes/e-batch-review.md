# Review of `handoff/e-analytics` (E Phase 2 batch)

Reviewed by R18, 2026-10-23. The full suite was green: vitest 339, e2e 210. `next build` needs no DB. Ownership was respected and aggregations stay in SQL. The probe tests are in `e_batch_probe.spec.ts`.

## Verdicts

| Commit | Item | Verdict |
|---|---|---|
| 2ef182e | F32 + F27 | APPROVE |
| 4257179 | F20 E part | **CHANGES REQUESTED** |
| 12d76ea | nav test | APPROVE |
| 8a61a15 | F34 | APPROVE |
| 22a62cf | F13 UI + F31 | APPROVE |
| 85fe265 | F8 | APPROVE |
| c6d646c | F10 | APPROVE |
| 5ab1bbf | F11 + F12 | **CHANGES REQUESTED** |
| 4bd971d | B14 UI | APPROVE |
| f07ca97 | F28 + F29 | **CHANGES REQUESTED** |
| 7627e4d | F18 | APPROVE |

## Fixes needed before merging

Add these as new commits on top of the branch, then merge the whole branch.

### F20 (`MobileNav`)

- **Major: two `StreetSearch` instances are mounted.** The desktop one is only hidden with CSS, and both register a global Ctrl/⌘-K listener.
  - With the menu open at 320 px, Ctrl-K opens two dialogs, and both register in the modal stack.
  - Below `md` with the menu closed, Ctrl-K opens the invisible desktop dialog. The page scroll is locked and the focus trap points at nothing.
  - Fix: render a single instance, or give the menu copy `hotkey={false}`.
- **Minor:** Esc and an outside click don't close the menu.
- **Minor:** `aria-controls` points at an id that doesn't exist while the menu is closed.

### F11/F12 (`PriceChart` low-n styling)

- **Major: the address series is nearly invisible.** On the address page it is typically n = 1 per bucket with gaps in between. It is then drawn only as faint hollow dots at `strokeOpacity 0.55`, which gives about 2.3:1 contrast, below the 3:1 that WCAG 1.4.11 requires.
  - Fix: keep a full-opacity stroke and a larger radius, and mute low-n points by hollowness, a dash or a label instead.

### F28 (Recharts SSR)

- **Major: the server HTML causes a sideways scroll on phones.** `initialDimension` width 640 renders a fixed 640 px wrapper, so before hydration (and with JS off) `/insights` and `/compare` at 320 px scroll sideways (scrollWidth 685), plus layout shift.
  - Fix: set width ≤ 320, or add `overflow-hidden min-w-0` to the chart wrappers.
  - Add a `javaScriptEnabled:false` overflow check to `e2e/layout.spec.ts`.

## Minors and nits (can follow later)

- The insights tables' scroll wrappers need `role="region"`, `aria-label` and `tabIndex=0`, like `RecentSalesTable`.
- `plural.ts` should re-export `soldWord` from `map/format.ts`.
- `mom.ts`: a 0 % change shows as "up"; use `> 0`.
- Label symmetry: write "Medianpris/m²" to match "Medelpris/m²".
- `colSpan={6}className` is missing a space.
- The `g` granularity parameter isn't carried through drill-down links.
- Insights stat cards are clipped at 320 px.
- The grey street series colour `#a1a1aa` has 2.56:1 contrast.
- The desktop-header e2e passes on the old code too, so it proves nothing.

## Confirmed gotcha

With Recharts 3.8.1, React 19 and Next 15.5.15 on a production build, `isAnimationActive={false}` on `PriceChart` series silently prevents client-side `<Link>` navigation from committing. The RSC request is sent, but the URL never changes and there is no console error. Add this to CLAUDE.md.

## New items for C

- `districtMomChange` and `topMovers` should expose a median.
- `recentSales` lacks the `pricePerSqmSek > 0` filter, so "Visar X av Y" can show X greater than Y.
