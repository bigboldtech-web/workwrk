// JSON-RPC as the MCP server speaks it (docs/plans/mcp-server.md 2.2 to
// 2.4, step 2 tests "protocol: negotiation; initialize with a bad header
// still answers; 202s, ping, unknown methods, ids; batches by version; the
// cursor ignored"). Fails on the code before step 2: none of this exists.

import { describe, expect, it, vi } from "vitest";
import { answerBody, classify, initializeResult, negotiate, versionOf, type ProtocolVersion, type RpcEnv } from "./protocol";
import { RpcError } from "./protocol";

function env(version: ProtocolVersion, over: Partial<RpcEnv> = {}): RpcEnv {
  return {
    version,
    listTools: () => [{ name: "who_am_i" }],
    callTool: async (name) => ({ content: [{ type: "text", text: `ran ${name}` }] }),
    ...over,
  };
}

const req = (id: unknown, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

describe("versions", () => {
  it("negotiates: echoes a supported version, else answers 2025-06-18", () => {
    expect(negotiate("2025-03-26")).toBe("2025-03-26");
    expect(negotiate("2025-06-18")).toBe("2025-06-18");
    expect(negotiate("2025-11-25")).toBe("2025-06-18");
    expect(negotiate(undefined)).toBe("2025-06-18");
  });

  it("ignores the header on a lone initialize, so one with a bad header still answers", async () => {
    const body = req(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    const v = versionOf("1999-01-01", body);
    expect(v).toEqual({ ok: true, version: "2025-03-26" });
    const out = await answerBody(body, env("2025-03-26"));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } } } });
  });

  it("takes every other message's version from the header, 2025-03-26 without one, and refuses an unsupported one", () => {
    expect(versionOf(null, req(1, "tools/list"))).toEqual({ ok: true, version: "2025-03-26" });
    expect(versionOf("2025-06-18", req(1, "tools/list"))).toEqual({ ok: true, version: "2025-06-18" });
    expect(versionOf("1999-01-01", req(1, "tools/list"))).toEqual({ ok: false });
    expect(versionOf("1999-01-01", [req(1, "initialize")])).toEqual({ ok: false });
  });

  it("gives serverInfo a title only where the version has one, and the instructions in both", () => {
    expect(initializeResult("2025-06-18")).toMatchObject({ serverInfo: { name: "workwrk", title: "WorkwrK", version: "1.0.0" } });
    expect(initializeResult("2025-03-26").serverInfo).toEqual({ name: "workwrk", version: "1.0.0" });
    expect(String(initializeResult("2025-03-26").instructions)).toContain("Nothing can be deleted through this connection.");
  });
});

describe("methods", () => {
  it("answers notifications and a client's responses 202 with no body", async () => {
    expect(await answerBody({ jsonrpc: "2.0", method: "notifications/initialized" }, env("2025-06-18"))).toEqual({ status: 202, body: null });
    expect(await answerBody({ jsonrpc: "2.0", id: 4, result: {} }, env("2025-06-18"))).toEqual({ status: 202, body: null });
    expect(await answerBody({ jsonrpc: "2.0", id: 5, error: { code: 1, message: "x" } }, env("2025-06-18"))).toEqual({ status: 202, body: null });
  });

  it("answers ping {}, an unknown method -32601, and echoes string and number ids", async () => {
    expect((await answerBody(req("a-1", "ping"), env("2025-06-18"))).body).toEqual({ jsonrpc: "2.0", id: "a-1", result: {} });
    expect((await answerBody(req(7, "resources/list"), env("2025-06-18"))).body).toMatchObject({ id: 7, error: { code: -32601 } });
  });

  it("refuses a bad id, a missing jsonrpc and a non-string method with -32600 and a 400", async () => {
    for (const bad of [req(null, "ping"), req(1.5, "ping"), req({ x: 1 }, "ping"), { id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: 3 }, "ping", 42]) {
      const out = await answerBody(bad, env("2025-06-18"));
      expect(out.status, JSON.stringify(bad)).toBe(400);
      expect(out.body).toMatchObject({ jsonrpc: "2.0", error: { code: -32600 } });
    }
    // The id is echoed when it was a good one.
    expect((await answerBody({ jsonrpc: "1.0", id: 9, method: "ping" }, env("2025-06-18"))).body).toMatchObject({ id: 9, error: { code: -32600 } });
    expect(classify({ jsonrpc: "2.0", id: 3, method: "ping" })).toEqual({ kind: "request", id: 3, method: "ping", params: undefined });
  });

  it("ignores the tools/list cursor and never gives a nextCursor", async () => {
    const out = await answerBody(req(1, "tools/list", { cursor: "page-2" }), env("2025-06-18"));
    expect(out.body).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "who_am_i" }] } });
  });

  it("checks tools/call's params: a name, and arguments that are an object", async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const e = env("2025-06-18", { callTool });
    expect((await answerBody(req(1, "tools/call", {}), e)).body).toMatchObject({ error: { code: -32602 } });
    expect((await answerBody(req(2, "tools/call", { name: "who_am_i", arguments: [1] }), e)).body).toMatchObject({ error: { code: -32602 } });
    expect((await answerBody(req(3, "tools/call", { name: "who_am_i", arguments: "x" }), e)).body).toMatchObject({ error: { code: -32602 } });
    expect(callTool).not.toHaveBeenCalled();
    expect((await answerBody(req(4, "tools/call", { name: "who_am_i" }), e)).body).toMatchObject({ id: 4, result: { content: [] } });
    expect(callTool).toHaveBeenCalledWith("who_am_i", {});
  });

  it("answers an unknown tool's RpcError as it is, and anything else as -32603 in our words", async () => {
    const unknown = env("2025-06-18", { callTool: async () => Promise.reject(new RpcError(-32602, "Invalid params", { reason: "no tool" })) });
    expect((await answerBody(req(1, "tools/call", { name: "nope" }), unknown)).body).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid params", data: { reason: "no tool" } } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = env("2025-06-18", { callTool: async () => Promise.reject(new Error("relation \"Doc\" does not exist")) });
    const out = (await answerBody(req(2, "tools/call", { name: "get_doc" }), broken)).body as { error: { code: number; message: string } };
    expect(out.error).toEqual({ code: -32603, message: "Something went wrong in WorkwrK. Try again." });
    vi.restoreAllMocks();
  });
});

describe("batches", () => {
  it("are refused under 2025-06-18", async () => {
    const out = await answerBody([req(1, "ping")], env("2025-06-18"));
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ id: null, error: { code: -32600 } });
  });

  it("are answered in order under 2025-03-26, an initialize inside answering its own -32600, notifications left out", async () => {
    const out = await answerBody(
      [req(1, "ping"), { jsonrpc: "2.0", method: "notifications/initialized" }, req(2, "initialize", { protocolVersion: "2025-03-26" }), req(3, "tools/list"), 7],
      env("2025-03-26"),
    );
    expect(out.status).toBe(200);
    const body = out.body as Array<{ id: unknown; result?: unknown; error?: { code: number } }>;
    expect(body.map((r) => r.id)).toEqual([1, 2, 3, null]);
    expect(body[0].result).toEqual({});
    expect(body[1].error?.code).toBe(-32600);
    expect(body[2].result).toEqual({ tools: [{ name: "who_am_i" }] });
    expect(body[3].error?.code).toBe(-32600);
  });

  it("charge each message before it runs: past the limit a request answers -32000 unrun, a notification is dropped", async () => {
    let left = 2;
    const callTool = vi.fn(async () => ({ content: [] }));
    const e = env("2025-03-26", { callTool, admit: () => (left -= 1) >= 0 });
    const out = await answerBody(
      [req(1, "ping"), req(2, "tools/call", { name: "who_am_i" }), req(3, "tools/call", { name: "who_am_i" }), { jsonrpc: "2.0", method: "notifications/x" }, req(4, "ping")],
      e,
    );
    expect(out.body).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: { content: [] } },
      { jsonrpc: "2.0", id: 3, error: { code: -32000, message: "Too many requests. Try again shortly." } },
      { jsonrpc: "2.0", id: 4, error: { code: -32000, message: "Too many requests. Try again shortly." } },
    ]);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("answer 202 when no message had an id, and refuse an empty batch or one over 20", async () => {
    expect(await answerBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], env("2025-03-26"))).toEqual({ status: 202, body: null });
    expect((await answerBody([], env("2025-03-26"))).status).toBe(400);
    expect((await answerBody(Array.from({ length: 21 }, (_, i) => req(i, "ping")), env("2025-03-26"))).status).toBe(400);
    expect((await answerBody(Array.from({ length: 20 }, (_, i) => req(i, "ping")), env("2025-03-26"))).status).toBe(200);
  });
});
