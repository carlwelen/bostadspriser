import { expect, test } from "./fixtures";

// F21: the street search is a modal combobox that works with the keyboard alone.
// Karlavägen (Östermalm) comes from the seeded fixture.

async function openSearch(page: import("@playwright/test").Page) {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Sök gata" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Sök gata" });
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}

test("opens from the keyboard and exposes combobox semantics", async ({ page }) => {
  const { dialog } = await openSearch(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-autocomplete", "list");
  const listboxId = await input.getAttribute("aria-controls");
  await expect(page.locator(`#${listboxId}`)).toHaveAttribute("role", "listbox");
  await expect(dialog.getByRole("option").first()).toBeVisible();
});

test("arrow keys move the active option and Enter opens it", async ({ page }) => {
  const { dialog } = await openSearch(page);
  const input = dialog.getByRole("combobox");
  await input.fill("karla");
  const options = dialog.getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Karlavägen");

  await page.keyboard.press("ArrowDown");
  const active = await input.getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator(`#${active}`)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/street\/ostermalm\/karlavagen$/);
});

test("ArrowDown/ArrowUp wrap around and Home/End jump", async ({ page }) => {
  const { dialog } = await openSearch(page);
  const input = dialog.getByRole("combobox");
  const options = dialog.getByRole("option");
  await expect(options.first()).toBeVisible(); // wait for the street index
  const n = await options.count();
  expect(n).toBeGreaterThan(2);
  const activeIndex = async () => {
    const id = await input.getAttribute("aria-activedescendant");
    return options.evaluateAll((els, want) => els.findIndex((e) => e.id === want), id);
  };
  await page.keyboard.press("ArrowUp"); // from nothing: last
  expect(await activeIndex()).toBe(n - 1);
  await page.keyboard.press("ArrowDown"); // wraps to first
  expect(await activeIndex()).toBe(0);
  // Home/End stay with the text caret in an editable combobox (APG).
  await page.keyboard.press("End");
  expect(await activeIndex()).toBe(0);
});

test("clicking a result navigates client-side, without a full page load", async ({ page }) => {
  const { dialog } = await openSearch(page);
  await dialog.getByRole("combobox").fill("karla");
  await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
  await dialog.getByRole("option").first().click();
  await expect(page).toHaveURL(/\/street\/ostermalm\/karlavagen$/);
  expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);
});

test("results use Swedish quotation marks when nothing matches", async ({ page }) => {
  const { dialog } = await openSearch(page);
  await dialog.getByRole("combobox").fill("zzzz");
  await expect(dialog.getByText("Ingen träff på ”zzzz”.")).toBeVisible();
});

test("Escape closes it and returns focus to the trigger", async ({ page }) => {
  const { trigger, dialog } = await openSearch(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Tab stays inside the open dialog and the page behind does not scroll", async ({ page }) => {
  const { dialog } = await openSearch(page);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("Escape does nothing while the search is closed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Vasastan", exact: true }).focus();
  const before = page.url();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Vasastan", exact: true })).toBeFocused();
  expect(page.url()).toBe(before);
});

test("announces the number of results and uses an SVG, not an emoji, as the icon", async ({ page }) => {
  const { dialog } = await openSearch(page);
  await dialog.getByRole("combobox").fill("karla");
  await expect(dialog.getByRole("status")).toHaveText("1 träff");
  await expect(dialog).not.toContainText("🔎");
  await expect(dialog.locator("svg").first()).toBeVisible();
});
