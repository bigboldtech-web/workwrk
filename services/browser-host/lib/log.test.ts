import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createApi } from "./api.mjs";
import { createCdpProxy } from "./cdp-proxy.mjs";
import { sha256 } from "./config.mjs";
import { createLog, logLine, safePart } from "./log.mjs";
import { createSessions } from "./sessions.mjs";
import { newBootKey } from "./tokens.mjs";

const lines: string[] = [];
const log = createLog({ write: (l) => void lines.push(l) });
let server: http.Server;
let port = 0;
let id = "";

beforeAll(async () => {
  const sessions = createSessions({
    cfg: { mode: "process", max: 2, proof: false, connectBase: "ws://127.0.0.1:0" },
    launcher: {
      launch: async (ask) => ({ browserWs: "ws://127.0.0.1:9/x", devtoolsBase: "http://127.0.0.1:9", tabTargetId: "T", stop: async () => undefined, exited: new Promise(() => undefined), stateEntry: { id: ask.id, pid: 9, pgid: 9, started: "x", profile: "/p" } }),
      reap: async () => 0,
      sweep: async () => 0,
    },
    state: { write: () => undefined, read: () => null },
    log,
    bootKey: newBootKey(),
  });
  const made = await sessions.create({ projectId: "p", region: "us-east-1", timeoutSeconds: 600, viewport: { width: 1280, height: 800 }, userMetadata: { wk: "tag" } });
  if (!made.ok) throw new Error("not made");
  id = made.session.id;
  const api = createApi({ cfg: { mode: "process", region: "us-east-1", keyHashes: [sha256("k")], publicUrl: "http://127.0.0.1:8789" }, sessions, log });
  const proxy = createCdpProxy({ sessions, log });
  server = http.createServer((req, res) => void api.handle(req, res));
  server.on("upgrade", (req, socket, head) => proxy.upgrade(req, socket, head));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const refusedWith = (path: string) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    ws.once("unexpected-response", (_q, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.once("error", () => resolve(-1));
    ws.once("open", () => resolve(101));
  });

describe("the host's log lines (section 7)", () => {
  it("a /connect/<id>?t=secret from 203.0.113.9 writes a line holding none of the id, the token or the address", async () => {
    lines.length = 0;
    expect(await refusedWith(`/connect/${id}?t=secret`)).toBe(401);
    expect(await refusedWith(`/connect/00000000-0000-4000-8000-000000000000?t=secret`)).toBe(404);
    await fetch(`http://127.0.0.1:${port}/v1/sessions/${id}/debug?t=secret`, { headers: { "x-forwarded-for": "203.0.113.9", "x-bb-api-key": "secret" } });
    await fetch(`http://127.0.0.1:${port}/v1/sessions/${id}/debug?t=secret`, { headers: { "x-forwarded-for": "203.0.113.9", "x-bb-api-key": "k" } });
    expect(lines).toEqual(["[host] connect refused 401", "[host] connect refused 404", expect.stringMatching(/^\[host\] api debug 401 \d+ms$/), expect.stringMatching(/^\[host\] api debug 200 \d+ms$/)]);
    const all = lines.join("\n");
    for (const kept of [id, "secret", "203.0.113.9", "/connect", "tag", "127.0.0.1"]) expect(all).not.toContain(kept);
  });

  it("writes only words, numbers, durations and counts: anything else is ?", () => {
    expect(logLine("host", ["api", "create", 201, { ms: 2140.4 }])).toBe("[host] api create 201 2140ms");
    expect(logLine("host", ["session", "ended", "timeout", { running: 3 }])).toBe("[host] session ended timeout running=3");
    expect(logLine("host", ["api", "/connect/abc?t=x", "203.0.113.9", "Bearer abc", { "x-key": 1 }, null, ["a"]])).toBe("[host] api ? ? ? ?=1 ? ?");
    expect(safePart("6f1c2a7e-6d0b-4a39-9a51-0d5c3a1e9b11")).toBe("?");
    expect(safePart({ ms: Number.NaN })).toBe("?ms");
  });
});
