import { createServer, request, type ClientRequest } from "node:http";
import type { AddressInfo } from "node:net";

/** Browser redirects bypass Playwright routes; enforce the origin at the transport too. */
export async function originProxy(origin: string, delayComparison = false) {
  if (new URL(origin).protocol !== "http:") throw new Error("The e2e app must use local HTTP");
  const pending = new Set<ClientRequest>();
  const server = createServer(async (incoming, outgoing) => {
    let destination: URL;
    try {
      destination = new URL(incoming.url ?? "");
    } catch {
      outgoing.destroy();
      return;
    }
    if (destination.origin !== origin) {
      outgoing.destroy();
      return;
    }
    if (delayComparison && destination.searchParams.get('series') === 'district:vasastan' && destination.searchParams.has('_rsc')) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    const upstream = request(destination, {
      method: incoming.method,
      headers: { ...incoming.headers, host: destination.host },
    }, (response) => {
      response.once("error", () => outgoing.destroy());
      response.once("close", () => {
        if (!response.complete) outgoing.destroy();
      });
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    pending.add(upstream);
    upstream.once("close", () => pending.delete(upstream));
    upstream.once("error", () => outgoing.destroy());
    incoming.once("aborted", () => upstream.destroy());
    outgoing.once("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  // The app is HTTP. Reject tunnels and upgrades before opening any connection.
  server.on("connect", (_request, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    // Chromium normally bypasses proxies for loopback; explicitly remove that bypass.
    options: { server: `http://127.0.0.1:${port}`, bypass: "<-loopback>" },
    async close() {
      for (const upstream of pending) upstream.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
