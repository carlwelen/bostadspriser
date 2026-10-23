import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// F20 (secondary pages): below the md breakpoint the header nav collapses into
// a "Meny" disclosure; every target must stay reachable at phone widths.

const WIDTHS = [412, 320];

async function openMenu(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  // Wait for hydration, otherwise the click lands before React attaches handlers.
  await page.waitForLoadState("networkidle");
  const toggle = page.getByRole("button", { name: "Meny" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return page.getByRole("navigation", { name: "Huvudmeny" });
}

for (const width of WIDTHS) {
  test(`the header menu exposes every nav target at ${width}px`, async ({ page }) => {
    await page.goto("/street/ostermalm/karlavagen");
    const menu = await openMenu(page, width);
    for (const [name, href] of [
      ["Karta", "/"],
      ["Insikter", "/insights"],
      ["Jämför", "/compare"],
      ["Östermalm", "/district/ostermalm"],
    ] as const) {
      const link = menu.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toBeInViewport({ ratio: 1 });
    }
    // The current page is shown but is not a link.
    await expect(menu.getByText("Karlavägen", { exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: /Sök gata/ })).toBeInViewport({ ratio: 1 });
  });

  test(`the header menu navigates at ${width}px`, async ({ page }) => {
    for (const [name, url] of [
      ["Insikter", /\/insights$/],
      ["Jämför", /\/compare$/],
      ["Karta", /\/$/],
    ] as const) {
      await page.goto("/district/ostermalm");
      const menu = await openMenu(page, width);
      await menu.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
  });
}

test("the desktop header shows the nav links and no menu button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/district/ostermalm");
  await expect(page.getByRole("button", { name: "Meny" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Insikter", exact: true }).first()).toBeVisible();
});

test("the street search opens from the mobile menu", async ({ page }) => {
  await page.goto("/insights");
  const menu = await openMenu(page, 320);
  await menu.getByRole("button", { name: /Sök gata/ }).click();
  await expect(page.getByRole("combobox", { name: "Sök gata eller stadsdel" })).toBeVisible();
});

// The sticky header must not become the containing block of the search overlay
// (backdrop-filter does that), or the backdrop would only cover the header.
test("the street search backdrop covers the whole viewport", async ({ page }) => {
  await page.goto("/insights");
  const menu = await openMenu(page, 320);
  await menu.getByRole("button", { name: /Sök gata/ }).click();
  const input = page.getByRole("combobox", { name: "Sök gata eller stadsdel" });
  await expect(input).toBeVisible();
  await page.mouse.click(5, 790); // far below the header: lands on the backdrop
  await expect(input).toBeHidden();
});
