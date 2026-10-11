// A minimal Chrome DevTools Protocol client over `ws`
// (docs/plans/ai-teammates-phase4.md Decision 35): flat sessions (one socket,
// every target's messages carrying its sessionId), numbered commands, a 15
// second limit on each (a command past it rejects with CdpTimeout), events
// by name, and onClose firing once, however the socket ends.
//
// Not playwright-core: its own target handling and interception would sit
// beside our guard during setup (cdp-driver.ts holds every new target before
// it loads). Production runs Node 20, which has no global WebSocket.
//
// THE ADDRESS IS A SECRET. A provider's connect address carries a signing
// key: it is never logged, and an error here names no address.
//
// Server-only: opens a socket.

import WebSocket from "ws";

/** How long one command may take before it rejects with CdpTimeout. */
export const CDP_COMMAND_TIMEOUT_MS = 15_000;

/** The largest message read: a page picture is the largest thing asked for. */
const MAX_PAYLOAD = 32 * 1024 * 1024;

export class CdpTimeout extends Error {
  constructor(method: string) {
    super(`CDP ${method} timed out`);
    this.name = "CdpTimeout";
  }
}

export class CdpClosed extends Error {
  constructor(method: string) {
    super(`CDP connection closed during ${method}`);
    this.name = "CdpClosed";
  }
}

export class CdpError extends Error {
  constructor(
    method: string,
    readonly code: number | null,
    message: string,
  ) {
    super(`CDP ${method}: ${message.slice(0, 200)}`);
    this.name = "CdpError";
  }
}

export interface Cdp {
  send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, fn: (params: any, sessionId?: string) => void): void;
  close(): Promise<void>;
  onClose(fn: () => void): void;
  readonly closed: boolean;
}

type Pending = { method: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** A Cdp over any socket-like object (the real one is `ws`; tests pass their own). */
export interface CdpSocket {
  send(data: string): void;
  close(): void;
  on(event: "message", fn: (data: unknown) => void): void;
  on(event: "close" | "error", fn: (...a: unknown[]) => void): void;
}

export function cdpOver(socket: CdpSocket, o: { commandTimeoutMs?: number } = {}): Cdp {
  const timeoutMs = o.commandTimeoutMs ?? CDP_COMMAND_TIMEOUT_MS;
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, Pending>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners = new Map<string, Array<(params: any, sessionId?: string) => void>>();
  const closers: Array<() => void> = [];

  const finish = () => {
    if (closed) return;
    closed = true;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new CdpClosed(p.method));
      pending.delete(id);
    }
    for (const fn of closers.splice(0)) {
      try {
        fn();
      } catch {
        /* a listener's throw never stops the others */
      }
    }
  };

  socket.on("message", (data: unknown) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      const err = msg.error as { code?: unknown; message?: unknown } | undefined;
      if (err) p.reject(new CdpError(p.method, typeof err.code === "number" ? err.code : null, typeof err.message === "string" ? err.message : "error"));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (typeof msg.method === "string") {
      const fns = listeners.get(msg.method);
      if (!fns) return;
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : undefined;
      for (const fn of [...fns]) {
        try {
          fn(msg.params ?? {}, sessionId);
        } catch (err) {
          console.error(`[browser] cdp listener ${msg.method} threw: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`);
        }
      }
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);

  return {
    get closed() {
      return closed;
    },
    send<T = unknown>(method: string, params: object = {}, sessionId?: string): Promise<T> {
      if (closed) return Promise.reject(new CdpClosed(method));
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CdpTimeout(method));
        }, timeoutMs);
        pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new CdpClosed(method));
        }
      });
    },
    on(event, fn) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    },
    onClose(fn) {
      if (closed) {
        fn();
        return;
      }
      closers.push(fn);
    },
    async close() {
      if (closed) return;
      try {
        socket.close();
      } catch {
        /* closing a socket that is gone */
      }
      finish();
    },
  };
}

/**
 * Connect to a browser's DevTools socket. Rejects with an error that names
 * no address when the socket does not open within `timeoutMs`.
 */
export async function connectCdp(wsUrl: string, o: { timeoutMs: number; commandTimeoutMs?: number }): Promise<Cdp> {
  return new Promise<Cdp>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl, { maxPayload: MAX_PAYLOAD, handshakeTimeout: o.timeoutMs, perMessageDeflate: false, followRedirects: false });
    } catch {
      reject(new Error("CDP connect failed"));
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.terminate();
      } catch {
        /* gone */
      }
      reject(new Error("CDP connect timed out"));
    }, o.timeoutMs);
    ws.once("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(cdpOver(ws as unknown as CdpSocket, { commandTimeoutMs: o.commandTimeoutMs }));
    });
    ws.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("CDP connect failed"));
    });
  });
}
