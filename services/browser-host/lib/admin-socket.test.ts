import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminSocket } from "./admin-socket.mjs";
import { createApi } from "./api.mjs";
import { sha256 } from "./config.mjs";
import { SILENT_LOG } from "./log.mjs";
import { createSessions } from "./sessions.mjs";
import { newBootKey } from "./tokens.mjs";

// A short folder: a unix socket's path is at most 104 bytes on macOS.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wkb-adm-"));
const sock = path.join(dir, "admin.sock");
const sessions = createSessions({
  cfg: { mode: "process", max: 3, proof: false, connectBase: "ws://127.0.0.1:0" },
  launcher: {
    launch: async (ask) => ({ browserWs: "ws://127.0.0.1:9/x", devtoolsBase: "http://127.0.0.1:9", tabTargetId: "T", stop: async () => undefined, exited: new Promise(() => undefined), stateEntry: { id: ask.id, pid: 9, pgid: 9, started: "x", profile: "/p" } }),
    reap: async () => 0,
    sweep: async () => 0,
  },
  state: { write: () => undefined, read: () => null },
  log: SILENT_LOG,
  bootKey: newBootKey(),
});
const admin = createAdminSocket({ path: sock, sessions, log: SILENT_LOG });
const api = createApi({ cfg: { mode: "process", region: "us-east-1", keyHashes: [sha256("k")], publicUrl: "http://127.0.0.1:8789" }, sessions, log: SILENT_LOG });
let server: http.Server;
let base = "";

beforeAll(async () => {
  await admin.listen();
  server = http.createServer((req, res) => void api.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await admin.close();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** One line to the socket, its one answer back. */
function ask(line: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const c = net.connect(sock);
    let buf = "";
    c.setEncoding("utf8");
    c.on("data", (d) => {
      buf += d;
      const at = buf.indexOf("\n");
      if (at >= 0) {
        resolve(JSON.parse(buf.slice(0, at)));
        c.end();
      }
    });
    c.on("error", reject);
    c.write(`${line}\n`);
  });
}

const create = () =>
  fetch(`${base}/v1/sessions`, {
    method: "POST",
    headers: { "x-bb-api-key": "k", "content-type": "application/json" },
    body: JSON.stringify({ projectId: "p", region: "us-east-1", timeout: 600, keepAlive: false, userMetadata: { wk: "t", row: "r" } }),
  });

describe("the admin socket (6.4)", () => {
  it("is mode 0600", () => {
    expect(fs.statSync(sock).mode & 0o777).toBe(0o600);
    expect(fs.statSync(sock).isSocket()).toBe(true);
  });

  it("drain refuses creates 503 draining, keeps the running sessions, and undrain opens them again", async () => {
    expect((await create()).status).toBe(201);
    expect(await ask('{"op":"drain"}')).toEqual({ ok: true });
    const refused = await create();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "unavailable", why: "draining" });
    expect(sessions.status().running).toBe(1);
    expect(await ask('{"op":"undrain"}')).toEqual({ ok: true });
    expect((await create()).status).toBe(201);
  });

  it("status counts running, starting and held", async () => {
    const release = sessions.holdSlot("selftest");
    expect(await ask('{"op":"status","id":7}')).toEqual({ id: 7, ok: true, result: { running: 2, starting: 0, held: 1 } });
    release?.();
  });

  it("refuses an unknown op, an unknown field and a line that is not JSON", async () => {
    expect(await ask('{"op":"rm -rf"}')).toEqual({ ok: false, error: "unknown_op" });
    expect(await ask('{"op":"drain","all":true}')).toEqual({ ok: false, error: "unknown_field" });
    expect(await ask("drain")).toEqual({ ok: false, error: "bad_request" });
    expect(sessions.draining()).toBe(false);
  });
});
