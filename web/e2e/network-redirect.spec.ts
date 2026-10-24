import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test as base, expect } from "./fixtures";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

type Servers = { origin: string; target: string; received: () => number };
const test = base.extend<{ redirectServers: Servers }>({
  redirectServers: async ({}, provide) => {
    let received = 0;
    const receiver = createServer((_request, response) => {
      received += 1;
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.end("escaped");
    });
    const target = `${await listen(receiver)}/escaped`;
    const app = createServer((request, response) => {
      const destination = request.url === "/off" ? target
        : request.url === "/chain" ? "/off"
          : request.url === "/same" ? "/final?kept=yes" : null;
      if (destination) {
        response.writeHead(302, { Location: destination });
        response.end();
      } else if (request.url === "/post") {
        response.writeHead(307, { Location: "/echo" });
        response.end();
      } else if (request.url === "/echo") {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ method: request.method, body }));
        });
      } else {
        response.setHeader("Content-Type", "text/html");
        response.end("<html><body>Local page</body></html>");
      }
    });
    const origin = await listen(app);
    try {
      await provide({ origin, target, received: () => received });
    } finally {
      await Promise.all([close(app), close(receiver)]);
    }
  },
  baseURL: async ({ redirectServers }, provide) => provide(redirectServers.origin),
});

for (const route of ["/off", "/chain"]) {
  test(`fetch redirects cannot leave the allowed origin via ${route} (B53)`, async ({ page, redirectServers }) => {
    await page.goto("/");
    const result = await page.evaluate(async (url) => {
      try { return await (await fetch(url)).text(); } catch { return "blocked"; }
    }, route);
    expect(result).toBe("blocked");
    expect(redirectServers.received()).toBe(0);
  });
}

test("top-level redirects cannot reach another origin (B53)", async ({ page, redirectServers }) => {
  await page.goto("/off").catch(() => {});
  expect(redirectServers.received()).toBe(0);
});

test("a new popup cannot escape through its initial redirect (B53)", async ({ page, context, redirectServers }) => {
  await page.goto("/");
  const failed = context.waitForEvent("requestfailed", { predicate: (request) => request.url() === redirectServers.target, timeout: 5000 }).then(() => "blocked");
  const finished = context.waitForEvent("requestfinished", { predicate: (request) => request.url() === redirectServers.target, timeout: 5000 }).then(() => "sent");
  const outcome = Promise.race([failed, finished]);
  await page.evaluate(() => { window.open("/chain"); });
  expect(await outcome).toBe("blocked");
  expect(redirectServers.received()).toBe(0);
});

test("same-origin redirects preserve the browser URL and request body (B53)", async ({ page, redirectServers }) => {
  await page.goto("/same");
  await expect(page).toHaveURL(`${redirectServers.origin}/final?kept=yes`);
  await expect(page.getByText("Local page")).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/post", { method: "POST", body: "room=2" })).json()))
    .toEqual({ method: "POST", body: "room=2" });
  expect(redirectServers.received()).toBe(0);
});
