import { test as base, expect } from "@playwright/test";
import { originProxy } from "./originProxy";

/**
 * Console errors that are known baseline bugs. Each entry names the backlog
 * item that removes it; delete the entry in the same commit as the fix.
 */
export const KNOWN_CONSOLE_ERRORS: Array<{ id: string; pattern: RegExp }> = [];

type Fixtures = { consoleErrors: string[] };

/**
 * Extends `test` with:
 *   - automatic hermetic network: any request outside the exact app origin is aborted;
 *   - `consoleErrors`: console.error / uncaught page errors collected during
 *     the test, minus KNOWN_CONSOLE_ERRORS. Assert it is empty.
 */
export const test = base.extend<Fixtures>({
  proxy: async ({ baseURL, browserName }, provide) => {
    if (browserName !== "chromium") throw new Error("The hermetic e2e proxy is verified for Chromium projects");
    const proxy = await originProxy(new URL(baseURL!).origin);
    try { await provide(proxy.options); } finally { await proxy.close(); }
  },
  serviceWorkers: "block",
  consoleErrors: [async ({ page, baseURL }, provide) => {
    const origin = new URL(baseURL!).origin;
    await page.context().route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    const errors: string[] = [];
    const keep = (msg: string) => {
      if (!KNOWN_CONSOLE_ERRORS.some((k) => k.pattern.test(msg))) errors.push(msg);
    };
    page.on("console", (m) => {
      if (m.type() === "error") keep(m.text());
    });
    page.on("pageerror", (e) => keep(`pageerror: ${e.message}`));
    await provide(errors);
  }, { auto: true }],
});

export { expect };
