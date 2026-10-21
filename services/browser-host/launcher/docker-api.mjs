// @ts-check
// The Docker Engine API over its unix socket (docs/plans/browser-host.md
// 5.5, Decision 19): the only file of the host that talks to Docker, used by
// the launcher service alone. boundaries.test.ts holds every other file to
// never naming the socket.
//
// Each call is one HTTP request on /var/run/docker.sock, versioned (v1.44,
// which Docker Engine 25 and later answer), with a timeout. Answers are read
// to at most 8 MB. Nothing here logs: the caller logs codes only.

import http from "node:http";

/** Docker's socket. Unix sockets cross network namespaces by path, so the launcher needs no network. */
export const DOCKER_SOCKET = "/var/run/docker.sock";
/** The Engine API version every path names. */
export const API_VERSION = "v1.44";
/** The most an answer may hold. */
export const ANSWER_MAX = 8 * 1024 * 1024;

/**
 * @typedef {{ status: number, json: any, text?: string }} EngineAnswer
 * @typedef {{
 *   request: (method: string, path: string, o?: { query?: Record<string, string>, body?: unknown, timeoutMs?: number }) => Promise<EngineAnswer>,
 *   build: (context: Buffer, query: Record<string, string>, timeoutMs: number) => Promise<{ ok: boolean }>,
 * }} Engine
 */

/** An Engine call that failed before it was answered. */
export class EngineUnreachable extends Error {
  constructor() {
    super("engine_unreachable");
  }
}

/**
 * The query string, in order.
 * @param {Record<string, string> | undefined} q
 */
function qs(q) {
  const entries = Object.entries(q ?? {});
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

/**
 * The Engine client.
 * @param {{ socketPath?: string, timeoutMs?: number }} [o]
 * @returns {Engine}
 */
export function createDockerApi(o = {}) {
  const socketPath = o.socketPath ?? DOCKER_SOCKET;
  const defaultTimeout = o.timeoutMs ?? 30_000;

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ query?: Record<string, string>, body?: Buffer | string, type?: string, timeoutMs?: number, onData?: (chunk: Buffer) => void }} r
   * @returns {Promise<{ status: number, text: string }>}
   */
  function raw(method, path, r) {
    return new Promise((resolve, reject) => {
      const body = r.body === undefined ? null : Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body);
      const req = http.request(
        {
          socketPath,
          method,
          path: `/${API_VERSION}${path}${qs(r.query)}`,
          headers: { host: "docker", ...(body ? { "content-type": r.type ?? "application/json", "content-length": String(body.length) } : {}) },
          timeout: r.timeoutMs ?? defaultTimeout,
        },
        (res) => {
          /** @type {Buffer[]} */
          const parts = [];
          let size = 0;
          res.on("data", (d) => {
            if (r.onData) {
              r.onData(d);
              return;
            }
            size += d.length;
            if (size > ANSWER_MAX) {
              req.destroy();
              reject(new EngineUnreachable());
              return;
            }
            parts.push(d);
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString("utf8") }));
          res.on("error", () => reject(new EngineUnreachable()));
        },
      );
      req.on("timeout", () => req.destroy(new EngineUnreachable()));
      req.on("error", () => reject(new EngineUnreachable()));
      if (body) req.write(body);
      req.end();
    });
  }

  return {
    async request(method, path, r = {}) {
      const res = await raw(method, path, { query: r.query, body: r.body === undefined ? undefined : JSON.stringify(r.body), timeoutMs: r.timeoutMs });
      let json = null;
      try {
        json = res.text ? JSON.parse(res.text) : null;
      } catch {
        json = null;
      }
      // The text too, for the one answer that is not JSON (a file's archive: ops.mjs reads the image's package hash).
      return { status: res.status, json, text: res.text };
    },
    async build(context, query, timeoutMs) {
      // The build's progress arrives as JSON lines; any line with an error fails it. Nothing of it is kept.
      let tail = "";
      let failed = false;
      let built = false;
      const res = await raw("POST", "/build", {
        query,
        body: context,
        type: "application/x-tar",
        timeoutMs,
        onData: (d) => {
          tail += String(d);
          let at;
          while ((at = tail.indexOf("\n")) >= 0) {
            const line = tail.slice(0, at);
            tail = tail.slice(at + 1);
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg && (msg.error || msg.errorDetail)) failed = true;
              if (msg && msg.aux && typeof msg.aux.ID === "string") built = true;
            } catch {
              failed = true;
            }
          }
          if (tail.length > 1024 * 1024) tail = tail.slice(-4096);
        },
      });
      return { ok: res.status === 200 && built && !failed };
    },
  };
}

/**
 * A tar archive of a few small files (the build's context): ustar headers,
 * each file padded to 512 bytes, and the two empty blocks that end it.
 * @param {Array<{ name: string, body: Buffer, mode?: number, mtime?: number }>} files
 * @returns {Buffer}
 */
export function tarOf(files) {
  /** @type {Buffer[]} */
  const blocks = [];
  for (const f of files) {
    if (!/^[A-Za-z0-9._-]{1,99}$/.test(f.name)) throw new Error("tar_bad_name");
    const h = Buffer.alloc(512, 0);
    h.write(f.name, 0, "ascii");
    h.write(`${(f.mode ?? 0o644).toString(8).padStart(7, "0")}\0`, 100, "ascii");
    h.write("0000000\0", 108, "ascii");
    h.write("0000000\0", 116, "ascii");
    h.write(`${f.body.length.toString(8).padStart(11, "0")}\0`, 124, "ascii");
    h.write(`${Math.floor(f.mtime ?? 0).toString(8).padStart(11, "0")}\0`, 136, "ascii");
    h.write("        ", 148, "ascii");
    h.write("0", 156, "ascii");
    h.write("ustar\0", 257, "ascii");
    h.write("00", 263, "ascii");
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    blocks.push(h, f.body, Buffer.alloc((512 - (f.body.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}
