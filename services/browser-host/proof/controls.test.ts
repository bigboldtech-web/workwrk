// The proof controls' input (docs/plans/browser-host.md Decision 17 and
// 12.1): on their own connection to the tab, their points from
// Runtime.evaluate as before, and every click and key the exact CDP commands
// the live view's mapper (lib/live-input.mjs) makes of a control viewer's
// messages, so the person's input in the proofs is a control viewer's.

import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { charKeyMessages, clickMessages, createInputMapper, enterMessages } from "../lib/live-input.mjs";
import { createControls } from "./controls.mjs";

type Sent = { method: string; params: Record<string, unknown> };
const sent: Sent[] = [];
let server: http.Server;
let wss: WebSocketServer;
let devtoolsBase = "";

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ type: "page", id: "T1", webSocketDebuggerUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/devtools/page/T1` }]));
  });
  wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      sent.push({ method: m.method, params: m.params });
      const expr = String(m.params?.expression ?? "");
      const result =
        m.method === "Runtime.evaluate" && expr.includes("getBoundingClientRect")
          ? { result: { value: { x: 100, y: 50 } } }
          : m.method === "Runtime.evaluate" && expr.includes(".options[")
            ? { result: { value: "Travel" } }
            : {};
      ws.send(JSON.stringify({ id: m.id, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  devtoolsBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  // The controls keep their connection until the session ends; this fake one never does.
  for (const c of wss.clients) c.terminate();
  await new Promise<void>((r) => wss.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => void (sent.length = 0));

function controls() {
  const session = { id: "S1", status: "running", viewport: { width: 1280, height: 800 }, launched: { devtoolsBase, tabTargetId: "T1" } };
  const sessions = {
    get: (id: string) => (id === "S1" ? session : undefined),
    onEnd: () => undefined,
    all: () => [session],
    json: (s: { id: string }) => ({ id: s.id }),
    reset: () => undefined,
    end: () => true,
    create: async () => ({ ok: false, status: 503, error: "unavailable" }),
  };
  const log = { file: "", record: () => ({ seq: 0, at: "" }), since: () => [], clear: () => undefined };
  return createControls({ cfg: { region: "us-east-1" }, sessions: sessions as never, log: log as never, fixtures: { reset: () => undefined } });
}

async function ask(c: ReturnType<typeof createControls>, what: string) {
  let status = 0;
  let body = "";
  const res = {
    headersSent: false,
    writeHead: (s: number) => void (status = s),
    end: (b: string) => void (body = b),
  };
  const url = new URL(`http://127.0.0.1/__stand-in/${what}`);
  await c.handle({} as never, res as never, url);
  return { status, body: JSON.parse(body) };
}

/** What the live view's mapper makes of a viewer's messages. */
const mapped = (messages: Array<Record<string, unknown>>) => {
  const m = createInputMapper({ width: 1280, height: 800 });
  return messages.flatMap((x) => {
    const r = m.map(x);
    if (!r.ok) throw new Error(r.why);
    return r.commands;
  });
};
const inputs = () => sent.filter((x) => x.method.startsWith("Input."));

describe("the proof controls' input is built by the live view's mapper", () => {
  it("click: the point from Runtime.evaluate on the controls' own connection, then a control viewer's click", async () => {
    const c = controls();
    expect(await ask(c, "click?session=S1&selector=%23submit")).toEqual({ status: 200, body: { ok: true } });
    expect(sent[0].method).toBe("Runtime.evaluate");
    expect(inputs()).toEqual(mapped(clickMessages(100, 50)));
    expect(inputs()[0].params).toEqual({ type: "mouseMoved", x: 100, y: 50, button: "none", buttons: 0, modifiers: 0 });
  });

  it("type, key by key, then Enter: each character a control viewer's key", async () => {
    const c = controls();
    expect(await ask(c, "type?session=S1&selector=%23amount&text=A4%40&keys=1&enter=1")).toEqual({ status: 200, body: { ok: true } });
    expect(inputs()).toEqual(mapped([...clickMessages(100, 50), ...charKeyMessages("A"), ...charKeyMessages("4"), ...charKeyMessages("@"), ...enterMessages()]));
  });

  it("type, the words at once: a control viewer's paste", async () => {
    const c = controls();
    expect(await ask(c, "type?session=S1&selector=%23email&text=max%40proof.test")).toEqual({ status: 200, body: { ok: true } });
    expect(inputs()).toEqual(mapped([...clickMessages(100, 50), { t: "text", text: "max@proof.test" }]));
    expect(inputs().at(-1)).toEqual({ method: "Input.insertText", params: { text: "max@proof.test" } });
    expect((await ask(c, `type?session=S1&selector=%23email&text=${"x".repeat(10_001)}`)).status).toBe(400);
  });

  it("choose: a click on the list, then the option's words as keys", async () => {
    const c = controls();
    expect(await ask(c, "choose?session=S1&selector=%23category&index=1")).toEqual({ status: 200, body: { ok: true } });
    expect(inputs()).toEqual(mapped([...clickMessages(100, 50), ...[..."Travel"].flatMap((ch) => charKeyMessages(ch))]));
  });
});
