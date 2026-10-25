# F12 keyboard focus correction

At baseline `a8789bd`, natural Tab reaches the chart and ArrowRight opens its keyboard tooltip. The tooltip precedes the SVG, so Shift+Tab enters its scrollable content. Recharts handles the bubbling SVG blur by clearing the tooltip before focus settles, leaving BODY focused. Mouse-activated focus tests did not cover that path.

The correction stops that blur only when focus moves within this chart container into its tooltip. Blur still dismisses the tooltip when moving back to the chart or out to period controls/full-page navigation. ArrowRight can reopen it. No observer, positioning, scrolling, or pointer behavior changed.

## Persistent checks

- `web/src/components/AddressDrawer.chart.test.ts`: real Recharts keyboard activation and focus transfer keep the same tooltip DOM node mounted; ordinary exit dismisses it. Before the correction this fails at the first focus transfer (`/tmp/d-f12-keyboard-unit-red.log`).
- `drawer-keyboard.spec.ts`: real Tab/Shift+Tab entry and exit, Home/End to every record, repeated entry, onward full-page navigation, Escape focus return from inside the tooltip, and no hover focus steal on desktop and Pixel 7.
- Existing `drawer-dense.spec.ts` and `drawer-short.spec.ts` retain real 8/20/200-record, wheel/touch, short-height clipping and live-resize coverage.

The independent reviewer reproduction was rerun unchanged except its JSON output path, preserving `/tmp/r-f12-correction` evidence. Before the correction it failed on both projects (`/tmp/d-f12-keyboard-red.log`); the original reviewer snapshots `/tmp/r-f12-correction/shift-tab-{desktop,mobile}.json` report BODY focus and `tooltip:false`.

## Reproduction

Temporarily place this page at `web/src/app/drawer-review-fixture/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { AddressDrawer } from "@/components/AddressDrawer";
export default function DrawerReview() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Öppna</button><AddressDrawer selection={open ? { district: "ostermalm", street: "Karlavägen", houseNumber: "10", address: "Karlavägen 10", pricePerSqm: 130_000, soldAt: "2026-06-20", sources: ["hemnet"] } : null} onClose={() => setOpen(false)} /></>;
}
```

Copy the three specs from this directory to `web/screens/`. From `web`, with `TEST_DB_NAME=bostadspriser_test_d E2E_PORT=3104` exported, run `pnpm e2e:build`, then `pnpm screens drawer-keyboard.spec.ts drawer-dense.spec.ts drawer-short.spec.ts`. The hermetic fixtures fulfill the address API locally, and the build has no Mapbox token. Remove all temporary copies and the fixture page before the full gate or any production build.

The corrected run, including the independent reviewer probe, is logged in `/tmp/d-f12-keyboard-browser-final-green.log`. Keyboard screenshots are `docs/screens/F12-keyboard-desktop.png` and `docs/screens/F12-keyboard-mobile.png`.
