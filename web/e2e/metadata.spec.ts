import { expect, test } from "./fixtures";

const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").origin;
for (const [path, title] of [
  ["/", "Bostadspriser — Stockholms innerstad"],
  ["/compare?series=district:ostermalm&g=year", "Jämför bostadspriser — Stockholms innerstad"],
  ["/insights", "Insikter — bostadspriser"],
  ["/district/ostermalm?rooms=1", "Östermalm — bostadspriser"],
  ["/street/ostermalm/karlavagen", "Karlavägen, Östermalm — bostadspriser"],
  ["/street/ostermalm/karlavagen/2", "Karlavägen 2, Östermalm — bostadspriser"],
]) {
  test(`${path} has page-specific sharing metadata and a canonical URL`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "sv_SE");
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/opengraph-image`));
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical!).href).toBe(new URL(path.split("?")[0], origin).href);
  });
}

test("sitemap includes insights and the default social image is a 1200×630 PNG", async ({ page }) => {
  const sitemap = (await page.goto("/sitemap.xml"))!;
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain(`<loc>${origin}/insights</loc>`);
  const image = (await page.goto("/opengraph-image"))!;
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toContain("image/png");
  const png = await image.body();
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});
