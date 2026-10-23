import { expect, test } from "./fixtures";

// Reviewer probes (R18). Not for commit.

test.describe("probe: mobile menu + street search", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
  });

  test("Ctrl-K with the mobile menu open opens exactly one search dialog", async ({ page }) => {
    await page.goto("/insights");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Meny" }).click();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Sök gata" }).first()).toBeAttached();
    expect(await page.getByRole("dialog", { name: "Sök gata", includeHidden: true }).count()).toBe(1);
  });

  test("Ctrl-K with the mobile menu closed opens a visible search dialog", async ({ page }) => {
    await page.goto("/insights");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("combobox", { name: "Sök gata eller stadsdel" })).toBeVisible();
  });

  test("Escape closes the open mobile menu and returns focus to the toggle", async ({ page }) => {
    await page.goto("/insights");
    await page.waitForLoadState("networkidle");
    const toggle = page.getByRole("button", { name: "Meny" });
    await toggle.click();
    await page.getByRole("navigation", { name: "Huvudmeny" }).getByRole("link", { name: "Jämför" }).focus();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("Esc in the search opened from the menu returns focus to the menu's trigger", async ({ page }) => {
    await page.goto("/insights");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Meny" }).click();
    const menu = page.getByRole("navigation", { name: "Huvudmeny" });
    await menu.getByRole("button", { name: /Sök gata/ }).click();
    await page.keyboard.press("Escape");
    await expect(menu.getByRole("button", { name: /Sök gata/ })).toBeFocused();
  });

  test("picking a street from the menu search lands with the menu closed", async ({ page }) => {
    await page.goto("/insights");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Meny" }).click();
    await page.getByRole("navigation", { name: "Huvudmeny" }).getByRole("button", { name: /Sök gata/ }).click();
    const input = page.getByRole("combobox", { name: "Sök gata eller stadsdel" });
    await input.fill("karlav");
    await page.getByRole("option").first().click();
    await expect(page).toHaveURL(/\/street\/ostermalm\/karlavagen$/);
    await expect(page.getByRole("button", { name: "Meny" })).toHaveAttribute("aria-expanded", "false");
  });
});

for (const timezoneId of ["America/Los_Angeles", "Pacific/Kiritimati", "Europe/Stockholm"]) {
  test.describe(`probe: x ticks in ${timezoneId}`, () => {
    test.use({ timezoneId });
    test("month and year ticks match the UTC bucket labels", async ({ page }) => {
      await page.goto("/street/ostermalm/karlavagen/2");
      await page.waitForLoadState("networkidle");
      const ticks = await page.locator("svg text").filter({ hasText: /^([a-zåäö]{3} \d{2}|\d{4})$/ }).allTextContents();
      console.log(timezoneId, "month ticks", JSON.stringify(ticks));
      expect(ticks[0]).toBe("jan 25");
      await page.goto("/street/ostermalm/karlavagen/2?g=year");
      await page.waitForLoadState("networkidle");
      const yt = await page.locator("svg text").filter({ hasText: /^([a-zåäö]{3} \d{2}|\d{4})$/ }).allTextContents();
      console.log(timezoneId, "year ticks", JSON.stringify(yt));
      expect(yt).toEqual(["2025", "2026"]);
      // Tooltip heading on hover over the first dot.
      await page.goto("/street/ostermalm/karlavagen/2");
      await page.waitForLoadState("networkidle");
      const dot = page.locator("svg circle.recharts-dot").first();
      const b = (await dot.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      const tip = await page.locator(".recharts-tooltip-wrapper").innerText();
      console.log(timezoneId, "tooltip", JSON.stringify(tip));
    });
  });
}

test("probe: address series breaks at empty months (no connectNulls)", async ({ page }) => {
  await page.goto("/street/ostermalm/karlavagen/2");
  await page.waitForLoadState("networkidle");
  const paths = await page.locator(".recharts-line-curve").evaluateAll((els) =>
    els.map((e) => ({ stroke: e.getAttribute("stroke"), moves: (e.getAttribute("d") ?? "").split("M").length - 1 }))
  );
  console.log("line paths", JSON.stringify(paths));
  const dots = await page.locator("circle.recharts-dot[data-low-sample=true]").count();
  console.log("low-sample dots", dots);
});

test("probe: a single-sale address renders a dot inside the plot", async ({ page }) => {
  await page.goto("/street/sodermalm/gotgatan/22");
  await page.waitForLoadState("networkidle");
  const dots = page.locator("svg circle.recharts-dot");
  console.log("single-sale dots", await dots.count());
  const xs = await dots.evaluateAll((els) => els.map((e) => [e.getAttribute("cx"), e.getAttribute("cy"), e.getAttribute("data-low-sample")]));
  console.log("single-sale dot coords", JSON.stringify(xs));
  const ticks = await page.locator("svg text").filter({ hasText: /^([a-zåäö]{3} \d{2}|\d{4})$/ }).allTextContents();
  console.log("single-sale ticks", JSON.stringify(ticks));
  const cards = await page.locator("main > section").first().innerText();
  console.log("single-sale cards", JSON.stringify(cards));
});

test("probe: scroll regions are focusable and named", async ({ page }) => {
  await page.goto("/insights");
  const scrollers = await page.locator("div.overflow-x-auto").evaluateAll((els) =>
    els.map((e) => ({ role: e.getAttribute("role"), label: e.getAttribute("aria-label"), tabindex: e.getAttribute("tabindex") }))
  );
  console.log("insights scrollers", JSON.stringify(scrollers));
  await page.goto("/district/ostermalm");
  const r = await page.getByRole("region", { name: /Försäljningar/ }).count();
  console.log("district sales regions", r);
});

test("probe: no hydration errors on secondary pages", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const p of ["/insights", "/district/ostermalm", "/street/ostermalm/karlavagen/2", "/compare?g=year"]) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
  }
  console.log("console errors", JSON.stringify(errors));
  expect(errors).toEqual([]);
});

test("probe: client-side navigation after a chart page works", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
  await page.getByRole("link", { name: /^Karlavägen/ }).first().click();
  await expect(page).toHaveURL(/\/street\/ostermalm\/karlavagen$/);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
  await page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "År" }).click();
  await expect(page).toHaveURL(/g=year/);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
});

for (const width of [320, 412]) {
  test(`probe: stat card values are not clipped at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const p of ["/district/ostermalm", "/street/ostermalm/karlavagen", "/street/ostermalm/karlavagen/2", "/insights"]) {
      await page.goto(p);
      const clipped = await page.locator("main > section").first().locator("p.mt-2").evaluateAll((els) =>
        els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => `${e.textContent} (${e.scrollWidth}>${e.clientWidth})`)
      );
      console.log(width, p, "clipped values", JSON.stringify(clipped));
      await page.screenshot({ path: `/tmp/review-r18-shots/${width}${p.replaceAll("/", "_")}.png`, fullPage: false });
    }
  });
}

for (const p of ["/street/ostermalm/karlavagen/2", "/street/sodermalm/gotgatan/22", "/district/ostermalm", "/compare"]) {
  test(`probe: chart screenshot ${p}`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    const chart = page.locator(".recharts-wrapper").first();
    await chart.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    await chart.screenshot({ path: `/tmp/review-r18-shots/chart${p.replaceAll("/", "_")}.png` });
    const labels = await page.locator("main > section").first().locator("p").evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    console.log("clipped", JSON.stringify(labels));
  });
}
test("probe: 320 label clipping on district", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  for (const p of ["/district/ostermalm", "/street/ostermalm/karlavagen", "/insights"]) {
    await page.goto(p);
    const labels = await page.locator("main > section").first().locator("p").evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    console.log(p, "clipped at 320", JSON.stringify(labels));
  }
});

test.describe("probe: no-JS first paint", () => {
  test.use({ javaScriptEnabled: false });
  for (const p of ["/district/ostermalm", "/insights", "/compare"]) {
    test(`probe: ${p} at 320px before hydration`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(p);
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        svgs: [...document.querySelectorAll("svg.recharts-surface")].map((s) => s.getAttribute("width")),
        wide: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 330).slice(0, 4).map((e) => `${e.tagName}.${e.className}|${e.getAttribute("style")}|${Math.round(e.getBoundingClientRect().width)}`),
      }));
      console.log(p, "noJS", JSON.stringify(r));
    });
  }
});

test("probe: soft navigation from chart pages (links + toggle + compare presets)", async ({ page }) => {
  await page.goto("/district/ostermalm");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));
  const marker = () => page.evaluate(() => (window as unknown as { __m?: number }).__m);
  await page.getByRole("link", { name: "Jämför →" }).click();
  await expect(page).toHaveURL(/\/compare\?series=district/);
  expect(await marker()).toBe(1);
  await page.getByRole("link", { name: "Vasastan", exact: true }).first().click();
  await expect(page).toHaveURL(/vasastan/);
  expect(await marker()).toBe(1);
  await page.getByRole("link", { name: "Insikter", exact: true }).first().click();
  await expect(page).toHaveURL(/\/insights$/);
  expect(await marker()).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/vasastan/);
  await page.goBack();
  await expect(page).toHaveURL(/\/compare\?series=district(%3A|:)ostermalm$/);
  expect(await marker()).toBe(1);
});

test("probe: toggle click diagnostics", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  page.on("request", (r) => { if (r.url().includes("karlavagen")) logs.push(`req ${r.method()} ${r.url()} rsc=${r.headers()["rsc"] ?? ""}`); });
  await page.goto("/street/ostermalm/karlavagen");
  await page.waitForLoadState("networkidle");
  logs.push("--- click År");
  await page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "År" }).click();
  await page.waitForTimeout(3000);
  logs.push(`url after: ${page.url()}`);
  logs.push("--- click År again after wait");
  await page.getByRole("group", { name: "Tidsupplösning" }).getByRole("link", { name: "År" }).click();
  await page.waitForTimeout(3000);
  logs.push(`url after 2: ${page.url()}`);
  console.log(logs.join("\n"));
});

test("probe: sales region", async ({ page }) => {
  await page.goto("/district/ostermalm");
  const region = page.getByRole("region", { name: /Försäljningar/ });
  await expect(region).toHaveCount(1);
  console.log("region tabindex", await region.getAttribute("tabindex"), await region.getAttribute("aria-label"));
});

test("probe: single-bucket yearly chart", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/street/ostermalm/strandvagen?g=year");
  await page.waitForLoadState("networkidle");
  const chart = page.locator(".recharts-wrapper").first();
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await chart.screenshot({ path: "/tmp/review-r18-shots/single-year.png" });
  const dots = await page.locator("svg circle.recharts-dot").evaluateAll((els) => els.map((e) => [e.getAttribute("cx"), e.getAttribute("cy")]));
  const ticks = await page.locator("svg text").filter({ hasText: /^\d{4}$/ }).allTextContents();
  console.log("single-year dots", JSON.stringify(dots), "ticks", JSON.stringify(ticks));
});
