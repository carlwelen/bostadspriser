import { expect, test } from "./fixtures";

test("comparison removals show pending state and recover with current selection", async ({ page, consoleErrors }, info) => {
  const selected = page.getByRole("group", { name: "Valda serier" });
  const removeStreet = selected.getByRole("link", { name: "Ta bort Götgatan (Södermalm)", exact: true });
  const input = page.getByRole("combobox", { name: "Lägg till gata eller stadsdel" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted!: () => void;
  const requested = new Promise<void>((resolve) => { intercepted = resolve; });
  const mutations: string[] = [];
  await page.route("**/compare?**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.searchParams.has("_rsc")) return route.fallback();
    if (!request.headers()["next-router-prefetch"]) mutations.push(url.searchParams.get("series") ?? "");
    if (url.searchParams.get("series") === "street:sodermalm/gotgatan,district:vasastan") {
      intercepted();
      await held;
    }
    await route.continue();
  });

  await page.goto("/compare?series=district:ostermalm,street:sodermalm/gotgatan,district:vasastan&g=year");
  await input.fill("ready");
  await input.clear();
  await input.press("Escape");
  await selected.getByRole("link", { name: "Ta bort Östermalm", exact: true }).click();
  await requested;
  try {
    await expect(page.getByRole("status")).toHaveText("Uppdaterar jämförelsen…");
    await expect(input).toBeDisabled();
    await expect(removeStreet).toBeDisabled();
    await expect(removeStreet).toHaveCSS("cursor", "wait");
    await expect(removeStreet).toHaveAttribute("href", /district%3Aostermalm.*district%3Avasastan.*g=year/);
    // Real pointer and keyboard activation must not start a stale mutation.
    await removeStreet.scrollIntoViewIfNeeded();
    const box = (await removeStreet.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await removeStreet.focus();
    await page.keyboard.press("Enter");
    await expect(selected.getByRole("link")).toHaveCount(3);
    expect(mutations).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("pending.png"), fullPage: true });
  } finally {
    release();
  }

  await expect(selected.getByRole("link")).toHaveCount(2);
  await expect(removeStreet).toBeEnabled();
  await expect(removeStreet).toHaveAttribute("href", "/compare?series=district%3Avasastan&g=year");
  await removeStreet.focus();
  await page.keyboard.press("Enter");
  await expect(selected.getByRole("link")).toHaveCount(1);
  await selected.getByRole("link", { name: "Ta bort Vasastan", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inga serier valda");
  await expect(page).toHaveURL(/series=&g=year$/);
  expect(consoleErrors).toEqual([]);
});

test("comparison removal retains native new-tab links", async ({ page, context, consoleErrors }) => {
  await page.goto("/compare?series=district:ostermalm,district:vasastan&g=year");
  const remove = page.getByRole("link", { name: "Ta bort Östermalm", exact: true });
  await expect(remove).toHaveAttribute("href", "/compare?series=district%3Avasastan&g=year");
  const opened = context.waitForEvent("page");
  await remove.click({ modifiers: ["ControlOrMeta"] });
  const newTab = await opened;
  await expect(newTab).toHaveURL(/series=district%3Avasastan&g=year$/);
  await expect(newTab.getByRole("heading", { level: 1 })).toHaveText("Vasastan");
  await expect(page.getByRole("group", { name: "Valda serier" }).getByRole("link")).toHaveCount(2);
  await newTab.close();
  expect(consoleErrors).toEqual([]);
});
