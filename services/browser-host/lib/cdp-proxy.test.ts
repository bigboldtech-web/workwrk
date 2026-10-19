import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { createCdpProxy } from "./cdp-proxy.mjs";
import { SILENT_LOG } from "./log.mjs";
import { createSessions } from "./sessions.mjs";
import { connectToken, newBootKey } from "./tokens.mjs";

/** A fake Chrome: a websocket server on 127.0.0.1 that records what it gets. */
async function fakeChrome() {
  const got: Array<{ data: string; binary: boolean }> = [];
  const peers: WebSocket[] = [];
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, perMessageDeflate: false });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  wss.on("connection", (ws) => {
    peers.push(ws);
    ws.on("message", (data, binary) => got.push({ data: Buffer.from(data as Buffer).toString("latin1"), binary }));
  });
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/devtools/browser/fake`;
  return { url, got, peers, close: () => new Promise<void>((r) => wss.close(() => r())) };
}

type Env = Awaited<ReturnType<typeof setup>>;
let env: Env | null = null;

async function setup() {
  const chrome = await fakeChrome();
  const bootKey = newBootKey();
  const stops: string[] = [];
  const launcher = {
    async launch(ask: { id: string }) {
      return {
        browserWs: chrome.url,
        devtoolsBase: "http://127.0.0.1:1",
        tabTargetId: "T",
        stop: async () => void stops.push(ask.id),
        exited: new Promise<string>(() => undefined),
        stateEntry: { id: ask.id, pid: 4242, pgid: 4242, started: "x", profile: `/p/${ask.id}` },
      };
    },
    reap: async () => 0,
    sweep: async () => 0,
  };
  const sessions = createSessions({
    cfg: { mode: "process", max: 5, proof: false, connectBase: "ws://127.0.0.1:0" },
    launcher,
    state: { write: () => undefined, read: () => null },
    log: SILENT_LOG,
    bootKey,
  });
  const proxy = createCdpProxy({ sessions, log: SILENT_LOG });
  const server = http.createServer((_req, res) => res.end());
  server.on("upgrade", (req, socket, head) => {
    if (!proxy.upgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const make = async () => {
    const r = await sessions.create({ projectId: "p", region: "us-east-1", timeoutSeconds: 600, viewport: { width: 1280, height: 800 }, userMetadata: {} });
    if (!r.ok) throw new Error("not made");
    return { s: r.session, url: `ws://127.0.0.1:${port}/connect/${r.session.id}?t=${connectToken(bootKey, r.session.id)}` };
  };
  return {
    chrome,
    sessions,
    stops,
    port,
    make,
    close: async () => {
      proxy.close();
      await new Promise<void>((r) => server.close(() => r()));
      await chrome.close();
    },
  };
}

/** Open a client: its socket once open, or the status the upgrade was refused with. */
function open(url: string, o: WebSocket.ClientOptions = {}): Promise<{ ws: WebSocket } | { status: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { perMessageDeflate: false, followRedirects: false, ...o });
    ws.once("open", () => resolve({ ws }));
    ws.once("unexpected-response", (_req, res) => {
      resolve({ status: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.once("error", () => resolve({ status: -1 }));
  });
}

async function connected(url: string, o?: WebSocket.ClientOptions): Promise<WebSocket> {
  const r = await open(url, o);
  if (!("ws" in r)) throw new Error(`refused ${r.status}`);
  return r.ws;
}

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  vi.useRealTimers();
  await env?.close();
  env = null;
});

describe("the relay (6.3)", () => {
  it("passes messages both ways, unchanged and in order, text as text and binary as binary", async () => {
    const e = env!;
    const { url } = await e.make();
    const client = await connected(url);
    const fromClient: Array<{ data: string; binary: boolean }> = [];
    for (let i = 0; i < 200; i += 1) {
      const text = JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: `"\\u00e9 ${i}"` } });
      client.send(text);
      fromClient.push({ data: Buffer.from(text, "utf8").toString("latin1"), binary: false });
      if (i % 50 === 0) {
        const bin = Buffer.from([0, 255, i, 13, 10, 0xc3]);
        client.send(bin, { binary: true });
        fromClient.push({ data: bin.toString("latin1"), binary: true });
      }
    }
    await until(() => e.chrome.got.length === fromClient.length);
    expect(e.chrome.got).toEqual(fromClient);

    const back: Array<{ data: string; binary: boolean }> = [];
    client.on("message", (data, binary) => back.push({ data: Buffer.from(data as Buffer).toString("latin1"), binary }));
    const upstream = e.chrome.peers[0];
    const sent: Array<{ data: string; binary: boolean }> = [];
    for (let i = 0; i < 100; i += 1) {
      const text = `{"id":${i},"result":{"x":"ü"}}`;
      upstream.send(text);
      sent.push({ data: Buffer.from(text, "utf8").toString("latin1"), binary: false });
    }
    upstream.send(Buffer.from([1, 2, 3]), { binary: true });
    sent.push({ data: Buffer.from([1, 2, 3]).toString("latin1"), binary: true });
    await until(() => back.length === sent.length);
    expect(back).toEqual(sent);
    client.close();
  });
});

describe("the upgrade", () => {
  it("a second connect gets 409, while the first is open and after it", async () => {
    const e = env!;
    const { url, s } = await e.make();
    const first = await connected(url);
    expect(await open(url)).toEqual({ status: 409 });
    first.close();
    await until(() => s.status === "ended" || s.status === "ending");
    expect(await open(url)).toEqual({ status: 409 });
  });

  it("a wrong token gets 401, and an unknown session 404", async () => {
    const e = env!;
    const { url, s } = await e.make();
    expect(await open(url.replace(/t=[^&]+/, "t=wrong"))).toEqual({ status: 401 });
    expect(await open(url.replace(s.id, "00000000-0000-4000-8000-000000000000"))).toEqual({ status: 404 });
    expect(s.connected).toBe(false);
    expect(s.status).toBe("running");
  });
});

/** A raw upgrade request: the first line of the answer. */
function rawUpgrade(port: number, target: string, extra: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const c = net.connect(port, "127.0.0.1", () => {
      const headers = { Host: `127.0.0.1:${port}`, Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13", ...extra };
      c.write(`GET ${target} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    });
    let got = "";
    c.on("data", (d) => {
      got += String(d);
      if (got.includes("\r\n")) {
        resolve(got.split("\r\n")[0]);
        c.destroy();
      }
    });
    c.on("error", () => resolve(got.split("\r\n")[0] || "error"));
    c.on("close", () => resolve(got.split("\r\n")[0] || "closed"));
  });
}

describe("a target that is not a path", () => {
  it("is refused 400, and the host goes on answering", async () => {
    const e = env!;
    const { url } = await e.make();
    expect(await rawUpgrade(e.port, "http://a:99999/connect/x")).toBe("HTTP/1.1 400 Bad Request");
    expect(await rawUpgrade(e.port, "//evil.example/connect/x")).toBe("HTTP/1.1 400 Bad Request");
    const client = await connected(url);
    expect(client.readyState).toBe(WebSocket.OPEN);
    client.close();
  });
});

describe("the token is spent only once the handshake succeeds", () => {
  it("a malformed handshake with the right token leaves it good for the real connect", async () => {
    const e = env!;
    const { url, s } = await e.make();
    const target = url.replace(/^ws:\/\/[^/]+/, "");
    expect(await rawUpgrade(e.port, target, { "Sec-WebSocket-Version": "99" })).toMatch(/^HTTP\/1\.1 400/);
    expect(await rawUpgrade(e.port, target, { "Sec-WebSocket-Key": "short" })).toMatch(/^HTTP\/1\.1 400/);
    expect(s.connected).toBe(false);
    const client = await connected(url);
    expect(s.connected).toBe(true);
    expect(await open(url)).toEqual({ status: 409 });
    client.close();
  });
});

describe("either side closing", () => {
  it("a client close ends the session, last_client_left, and closes the upstream", async () => {
    const e = env!;
    const { url, s } = await e.make();
    const client = await connected(url);
    await until(() => e.chrome.peers.length === 1);
    const upstreamClosed = new Promise<void>((r) => e.chrome.peers[0].once("close", () => r()));
    client.close();
    await upstreamClosed;
    await until(() => s.endReason !== null);
    expect(s.endReason).toBe("last_client_left");
    expect(e.stops).toEqual([s.id]);
  });

  it("an upstream close closes the client and ends the session", async () => {
    const e = env!;
    const { url, s } = await e.make();
    const client = await connected(url);
    await until(() => e.chrome.peers.length === 1);
    const clientClosed = new Promise<void>((r) => client.once("close", () => r()));
    e.chrome.peers[0].close();
    await clientClosed;
    await until(() => s.endReason !== null);
    expect(s.endReason).toBe("chrome_exited");
  });

  it("the session ending (a release) closes the client", async () => {
    const e = env!;
    const { url, s } = await e.make();
    const client = await connected(url);
    const clientClosed = new Promise<void>((r) => client.once("close", () => r()));
    e.sessions.release(s.id);
    await clientClosed;
    expect(s.endReason).toBe("released");
  });
});

describe("keepalive", () => {
  it("pings the client, and closes one that stops answering after 120 seconds", async () => {
    // Only the monotonic clock moves: a keepalive on the wall clock would never see the time pass (Risk 17).
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const e = env!;
    const { url, s } = await e.make();
    const client = await connected(url, { autoPong: false });
    let pings = 0;
    client.on("ping", () => (pings += 1));
    const closed = new Promise<void>((r) => client.once("close", () => r()));
    for (let i = 0; i < 4; i += 1) vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(pings).toBe(4), { timeout: 3000, interval: 10 });
    expect(s.status).toBe("running");
    vi.advanceTimersByTime(30_000);
    await closed;
    await vi.waitFor(() => expect(s.endReason).toBe("last_client_left"), { timeout: 3000, interval: 10 });
  });

  it("keeps a client that answers", async () => {
    // Only the monotonic clock moves: a keepalive on the wall clock would never see the time pass (Risk 17).
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const e = env!;
    const { url, s } = await e.make();
    const client = await connected(url);
    let pongs = 0;
    client.on("ping", () => (pongs += 1));
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(30_000);
      await vi.waitFor(() => expect(pongs).toBe(i + 1), { timeout: 3000, interval: 10 });
    }
    expect(s.status).toBe("running");
    client.close();
  });
});
