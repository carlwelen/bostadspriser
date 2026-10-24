import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "./fixtures";

async function localReceiver(baseURL: string, sharedPrefix: boolean) {
  let received = 0;
  const server = createServer((_request, response) => {
    received += 1;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.end("request reached another origin");
  });
  const base = new URL(baseURL);
  const first = sharedPrefix ? Number(base.port) * 10 : 0;
  const candidates = sharedPrefix ? Array.from({ length: 10 }, (_, i) => first + i) : [0];
  for (const port of candidates) {
    if (port > 65535) throw new Error("Use an E2E_PORT below 6554 for the shared-prefix probe");
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", onError);
          resolve();
        });
      });
      const address = server.address() as AddressInfo;
      return {
        url: `http://127.0.0.1:${address.port}/probe`,
        received: () => received,
        close: () => new Promise<void>((resolve, reject) =>
          server.close((error) => error ? reject(error) : resolve())),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No unused local shared-prefix port for the network probe");
}

async function tryFetch(page: import("@playwright/test").Page, url: string) {
  return page.evaluate(async (target) => {
    try {
      return await (await fetch(target)).text();
    } catch {
      return "blocked";
    }
  }, url);
}

// Intentionally does not request consoleErrors: routing must be automatic.
test("every browser test blocks other origins without opting into a fixture (B53)", async ({ page, baseURL }) => {
  const receiver = await localReceiver(baseURL!, false);
  try {
    await page.goto("/");
    expect(new URL(receiver.url).origin).not.toBe(new URL(baseURL!).origin);
    expect(await tryFetch(page, receiver.url)).toBe("blocked");
    expect(receiver.received()).toBe(0);
  } finally {
    await receiver.close();
  }
});

test("a different port sharing the app origin prefix is blocked (B53)", async ({ page, baseURL, consoleErrors }) => {
  void consoleErrors; // Also proves the old opt-in route check was insufficient.
  const receiver = await localReceiver(baseURL!, true);
  try {
    expect(receiver.url.startsWith(new URL(baseURL!).origin)).toBe(true);
    await page.goto("/");
    expect(await tryFetch(page, receiver.url)).toBe("blocked");
    expect(receiver.received()).toBe(0);
  } finally {
    await receiver.close();
  }
});
