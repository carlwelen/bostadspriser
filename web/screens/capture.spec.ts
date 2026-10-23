import path from "node:path";
import { test } from "../e2e/fixtures";

const id = process.env.SCREENS_ID;
const paths = (process.env.SCREENS_PATHS ?? "/").split(",").filter(Boolean);
const OUT = path.resolve(__dirname, "../../docs/screens");

const slug = (p: string) => p.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-") || "home";

for (const p of paths) {
  test(`capture ${p}`, async ({ page, consoleErrors }, info) => {
    if (!id) throw new Error("set SCREENS_ID (backlog id, e.g. F1)");
    void consoleErrors; // installs the hermetic network fixture
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(OUT, `${id}-${slug(p)}-${info.project.name}.png`),
      fullPage: true,
    });
  });
}
