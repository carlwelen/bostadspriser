# F43 review: APPROVE

Commit: `69e3f2dc5d33fae9cb0f63c2fad5c9949f61d608` (`hardening/d-map-visibility`). Reviewed in a detached scratch worktree, against the authoritative main backlog F43 acceptance criteria: newly created/rebuilt layers must respect current mode and heatmap visibility after delayed data, deselection, and retry.

Concrete findings: none. No new backlog item identified.

The visibility effect runs after both layer-building effects and now reacts to their points/hexes inputs. Its operations are synchronous in the same passive-effect flush; data-only changes do not trigger the separately retained camera effect. Existing mode/checkbox/style-ready camera transitions remain unchanged.

Validation:

- Focused committed suites: **60/60** tests passed, including all **11/11** F43 cases (`focused-green.log`).
- Production-only reversion: **yes**, reverting only `web/src/components/HeatmapMap.tsx` to `69e3f2d^` caused **6 semantic failures / 5 passes** in the unchanged committed F43 tests (`production-reversion.log`). Failures observed visible price-points when the requested mode or checkbox required `none`.
- Five additional reviewer probes passed, for **16/16** in the expanded component suite and **65 unique unit cases** overall (`review-probes-green.log`, `review-probes-restored.log`). They verify stale success cannot replace a newer response, stale failure cannot clear reselected layers, empty-to-nonempty frequency responses, exact camera transition arguments/counts, and cancellation when deselected before the initial response. The expanded suite with the production reversion gave **10 failures / 6 passes** (`review-probes-reversion.log`).
- Adding data dependencies to the isolated camera effect caused **9 failures / 7 passes** from unwanted camera calls; restoring the source returned **16/16** green (`camera-mutation.log`).
- Built the immutable source with empty Mapbox token, then ran relevant hermetic browser suites on desktop and Pixel 7: **56/56** passed (`browser.log`). Used only `bostadspriser_test_r_f43`, port `3114`. The production build also completed lint/type checks (`build.log`).
- Inspected all four committed screenshots. They show Swedish price/frequency controls, unchecked overlay toggle, and the missing-token notice. They are UI/control evidence only. Neither these screenshots nor the browser suites exercise real Mapbox/WebGL rendering. The component tests exercise the actual React effects and real h3 aggregation with an offline Mapbox API stub. This limitation is accurately documented in the commit.
- The supplied `/tmp/d-f43-full-gate.log` records **554 Vitest / 348 browser / 764 pytest** passing. This was inspected, not independently rerun in full; the targeted review suites above are independent.

Commands: `commands.txt`. Full augmented test: `HeatmapMap.visibility.review.test.tsx`. Patch for the reviewer additions: `review-probes.patch`. No implementer/main source, protected files, provider services, or development DB were changed. No commit or push was made. Own scratch worktree removed after completion; report/probes/logs remain here.

The mock was strengthened to retain each source's `data` and update it on `setData`. Additional probe code:

```tsx

it("review: ignores an older response after a newer filter response", async () => {
  await mounted({ mode: "frequency", showHeatmap: false }, async ({ map, host, render }) => {
    await loadStyle(map);
    const older = state.requests.at(-1)!;
    await render({ filters: { sinceDays: 30 } });
    const newer = structuredClone(points);
    newer.features[0].properties.address = "New selection 2";
    newer.features[0].geometry.coordinates = [18.10, 59.35];
    const cameraMoves = map.easeTo.mock.calls.length;
    await act(async () => state.requests.at(-1)!.resolve(newer));
    const currentHexes = structuredClone(map.sources.get("listings-hex")!.data);
    await act(async () => older.resolve(structuredClone(points)));
    expect(map.sources.get("listings")!.data).toEqual(newer);
    expect(map.sources.get("listings-hex")!.data).toEqual(currentHexes);
    expect(host.textContent).toContain("New selection 2");
    expectLayers(map, "frequency", false);
    expect(map.easeTo).toHaveBeenCalledTimes(cameraMoves);
  });
});

it("review: a cancelled failure cannot clear reselected district layers", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await mounted({ mode: "frequency", showHeatmap: true }, async ({ map, host, render }) => {
    await loadStyle(map);
    await finishFetch();
    await render({ filters: { sinceDays: 30 } });
    const stale = state.requests.at(-1)!;
    await render({ districts: [] });
    expect(map.sources.get("listings")!.data).toEqual({ type: "FeatureCollection", features: [] });
    expect(map.sources.has("listings-hex")).toBe(false);
    await render({ districts: ["vasastan"], showHeatmap: false });
    await finishFetch();
    const cameraMoves = map.easeTo.mock.calls.length;
    await act(async () => stale.reject(new Error("cancelled request")));
    expect(host.textContent).not.toContain("Kunde inte hämta data.");
    expectLayers(map, "frequency", false);
    expect(map.sources.get("listings")!.data).toEqual(points);
    expect(map.easeTo).toHaveBeenCalledTimes(cameraMoves);
  });
});

it("review: empty then nonempty frequency data keeps price dots hidden and camera stable", async () => {
  await mounted({ mode: "frequency", showHeatmap: true }, async ({ map, render }) => {
    await loadStyle(map);
    const cameraMoves = map.easeTo.mock.calls.length;
    await act(async () => state.requests.at(-1)!.resolve({ ...points, features: [] }));
    expectLayers(map, "frequency", true);
    expect(map.sources.get("listings-hex")!.data).toEqual({ type: "FeatureCollection", features: [] });
    await render({ filters: { sinceDays: 30 } });
    await finishFetch();
    expectLayers(map, "frequency", true);
    expect(map.sources.get("listings-hex")!.data).not.toEqual({ type: "FeatureCollection", features: [] });
    expect(map.easeTo).toHaveBeenCalledTimes(cameraMoves);
  });
});

it("review: camera retains control transitions but does not react to replacement data", async () => {
  await mounted({}, async ({ map, render }) => {
    await loadStyle(map);
    expect(map.easeTo).toHaveBeenCalledExactlyOnceWith({ pitch: 0, bearing: -8, duration: 600 });
    await finishFetch();
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    await render({ mode: "frequency" });
    expect(map.easeTo).toHaveBeenCalledTimes(2);
    expect(map.easeTo).toHaveBeenLastCalledWith({ pitch: 55, bearing: -22, duration: 600 });
    await render({ showHeatmap: false });
    expect(map.easeTo).toHaveBeenCalledTimes(3);
    await render({ filters: { sinceDays: 30 } });
    await finishFetch();
    expect(map.easeTo).toHaveBeenCalledTimes(3);
    expectLayers(map, "frequency", false);
    await render({ mode: "price" });
    expect(map.easeTo).toHaveBeenCalledTimes(4);
    expect(map.easeTo).toHaveBeenLastCalledWith({ pitch: 0, bearing: -8, duration: 600 });
    expectLayers(map, "price", false);
  });
});

it("review: deselecting before initial response prevents stale layer creation", async () => {
  await mounted({ mode: "frequency", showHeatmap: false }, async ({ map, render }) => {
    await loadStyle(map);
    const stale = state.requests.at(-1)!;
    await render({ districts: [] });
    await act(async () => stale.resolve(structuredClone(points)));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
    await render({ districts: ["ostermalm"] });
    await finishFetch();
    expectLayers(map, "frequency", false);
  });
});

```
