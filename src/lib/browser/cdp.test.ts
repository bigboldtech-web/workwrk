// The CDP client (src/lib/browser/cdp.ts) against a socket server on this
// machine only (127.0.0.1, a port the system picks): numbered commands and
// their answers, flat sessions, events, a command past its limit rejecting
// with CdpTimeout, onClose firing once, and no error naming the address.

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { CdpClosed, CdpError, CdpTimeout, connectCdp } from "./cdp";

let server: WebSocketServer | null = null;

async function serve(onMessage: (ws: WebSocket, msg: Record<string, unknown>) => void): Promise<{ url: string; sockets: WebSocket[] }> {
  const sockets: WebSocket[] = [];
  server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((r) => server!.once("listening", () => r()));
  server.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (data) => onMessage(ws, JSON.parse(String(data))));
  });
  const addr = server.address() as { port: number };
  return { url: `ws://127.0.0.1:${addr.port}/devtools/browser/secret-token`, sockets };
}

afterEach(async () => {
  if (server) {
    for (const c of server.clients) c.terminate();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
});

describe("connectCdp", () => {
  it("answers each command by its id, with its session, and hears events", async () => {
    const { url } = await serve((ws, msg) => {
      if (msg.method === "Target.getTargets") ws.send(JSON.stringify({ id: msg.id, result: { targetInfos: [{ targetId: "t1" }] } }));
      if (msg.method === "Runtime.evaluate") {
        ws.send(JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: msg.sessionId }));
        ws.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, result: { result: { value: msg.sessionId } } }));
      }
      if (msg.method === "Bad.method") ws.send(JSON.stringify({ id: msg.id, error: { code: -32601, message: "'Bad.method' wasn't found" } }));
    });
    const cdp = await connectCdp(url, { timeoutMs: 2000 });
    const events: Array<[unknown, string | undefined]> = [];
    cdp.on("Page.loadEventFired", (p, s) => events.push([p, s]));
    expect(await cdp.send("Target.getTargets")).toEqual({ targetInfos: [{ targetId: "t1" }] });
    expect(await cdp.send("Runtime.evaluate", { expression: "1" }, "sess-9")).toEqual({ result: { value: "sess-9" } });
    expect(events).toEqual([[{ timestamp: 1 }, "sess-9"]]);
    await expect(cdp.send("Bad.method")).rejects.toBeInstanceOf(CdpError);
    await cdp.close();
  });

  it("rejects a command past its limit with CdpTimeout", async () => {
    const { url } = await serve(() => {});
    const cdp = await connectCdp(url, { timeoutMs: 2000, commandTimeoutMs: 50 });
    await expect(cdp.send("Page.navigate", { url: "https://x.example" })).rejects.toBeInstanceOf(CdpTimeout);
    await cdp.close();
  });

  it("fires onClose once when the other end goes, and rejects what was waiting", async () => {
    const { url, sockets } = await serve(() => {});
    const cdp = await connectCdp(url, { timeoutMs: 2000 });
    let closes = 0;
    cdp.onClose(() => (closes += 1));
    const waiting = cdp.send("Page.navigate", {});
    sockets[0].terminate();
    await expect(waiting).rejects.toBeInstanceOf(CdpClosed);
    await new Promise((r) => setTimeout(r, 20));
    await cdp.close();
    expect(closes).toBe(1);
    expect(cdp.closed).toBe(true);
    await expect(cdp.send("Page.reload")).rejects.toBeInstanceOf(CdpClosed);
    // A listener added after the close hears it at once.
    let late = 0;
    cdp.onClose(() => (late += 1));
    expect(late).toBe(1);
  });

  it("names no address when it cannot connect", async () => {
    const { url } = await serve(() => {});
    const port = Number(new URL(url).port);
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    const err = await connectCdp(`ws://127.0.0.1:${port}/devtools/browser/secret-token`, { timeoutMs: 500 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain("secret-token");
    expect(String((err as Error).message)).not.toContain(String(port));
  });
});
