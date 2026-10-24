import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test as base, expect } from "./fixtures";

const test = base.extend<{ app: string }>({
  app: async ({}, provide) => {
    const server = createServer((request, response) => {
      if (request.url === "/abort") {
        response.writeHead(200, { "Content-Length": "100" });
        response.write("short");
        setTimeout(() => response.destroy(), 30);
      } else {
        response.setHeader("Content-Type", "text/html");
        response.end("<html>Owned local server</html>");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await provide(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  },
  baseURL: async ({ app }, provide) => provide(app),
});

test("an interrupted upstream body rejects in the browser (B53)", async ({ page }) => {
  await page.goto("/");
  const outcome = await page.evaluate(() => Promise.race([
    fetch("/abort").then((response) => response.text()).then(() => "complete", () => "rejected"),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 3000)),
  ]));
  expect(outcome).toBe("rejected");
});
