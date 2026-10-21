// JSON-RPC 2.0 as the MCP server speaks it (docs/plans/mcp-server.md 2.2 to
// 2.4). Stateless: no initialize is needed first, no session is kept, and
// every method needs a token (the transport checked it).
//
// VERSIONS. 2025-06-18 and 2025-03-26. initialize echoes a supported
// version the client asks for, else answers 2025-06-18, and ignores the
// MCP-Protocol-Version header. Every other message takes its version from
// the header, 2025-03-26 when there is none; an unsupported header is 400.
//
// BATCHES only under 2025-03-26 (2025-06-18 removed them): 1 to 20
// messages, answered in order; an initialize inside one answers its own
// -32600; the answer is the responses to the messages with an id, or 202
// when none had one. Each message is charged against the connection's
// minute limits before it runs (env.admit); one over answers -32000.
//
// METHODS. initialize, ping ({}), tools/list (params.cursor ignored, never
// a nextCursor) and tools/call; any other is -32601. A notification or a
// client's response is answered 202 with no body.
//
// ERRORS. -32700 (not JSON), -32600 (no jsonrpc "2.0", an id that is not a
// string or a whole number, a method that is not a string, a refused
// batch), -32601, -32602 (no tool name, arguments not an object, an unknown
// tool), -32603 (our own sentence, never the error itself).
//
// Pure: the transport hands in the tools (RpcEnv).

import { MCP_RPC_COPY, MCP_TOOL_COPY } from "./mcp-copy";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];
export const LATEST_VERSION: ProtocolVersion = "2025-06-18";
/** A message with no MCP-Protocol-Version header (the spec's backwards rule). */
export const HEADERLESS_VERSION: ProtocolVersion = "2025-03-26";
/** serverInfo.version. */
export const SERVER_VERSION = "1.0.0";
export const BATCH_MAX = 20;

export type RpcId = string | number;

/** A JSON-RPC error a handler raises on purpose (-32602 for a tool call). */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** What the transport hands the dispatcher for one request. */
export interface RpcEnv {
  /** The version of this request (negotiated for initialize). */
  version: ProtocolVersion;
  /** The tools this connection may see, already in this version's form. */
  listTools(): unknown[];
  /** One tool call's result (CallToolResult), or an RpcError. */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /**
   * A batch's per-message charge (review of step 2, M1): called once for each
   * message in order, before it is answered; false means the connection is
   * over its minute limit, and that request answers -32000 unrun.
   */
  admit?: () => boolean;
}

export function isVersion(v: unknown): v is ProtocolVersion {
  return typeof v === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(v);
}

/** initialize's answer to the version a client asks for. */
export function negotiate(requested: unknown): ProtocolVersion {
  return isVersion(requested) ? requested : LATEST_VERSION;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validId(v: unknown): v is RpcId {
  return (typeof v === "string" && v.length <= 1000) || (typeof v === "number" && Number.isSafeInteger(v));
}

export type Classified =
  | { kind: "request"; id: RpcId; method: string; params: unknown }
  | { kind: "notification"; method: string }
  | { kind: "response" }
  | { kind: "invalid"; id: RpcId | null };

/** What one message is. */
export function classify(msg: unknown): Classified {
  if (!isPlainObject(msg)) return { kind: "invalid", id: null };
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const id = hasId && validId(msg.id) ? msg.id : null;
  if (msg.jsonrpc !== "2.0") return { kind: "invalid", id };
  if (Object.prototype.hasOwnProperty.call(msg, "method")) {
    if (typeof msg.method !== "string") return { kind: "invalid", id };
    if (!hasId) return { kind: "notification", method: msg.method };
    if (id === null) return { kind: "invalid", id: null };
    return { kind: "request", id, method: msg.method, params: msg.params };
  }
  if (hasId && (Object.prototype.hasOwnProperty.call(msg, "result") || Object.prototype.hasOwnProperty.call(msg, "error"))) return { kind: "response" };
  return { kind: "invalid", id };
}

export function rpcResult(id: RpcId, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id: RpcId | null, code: number, message: string, data?: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** Is the body one initialize request (the only message that ignores the version header)? */
export function isLoneInitialize(body: unknown): boolean {
  return isPlainObject(body) && body.method === "initialize";
}

/**
 * 2.1 step 9: the version of a request. A lone initialize negotiates its
 * own; anything else takes the header, or 2025-03-26 without one.
 */
export function versionOf(header: string | null | undefined, body: unknown): { ok: true; version: ProtocolVersion } | { ok: false } {
  if (isLoneInitialize(body)) {
    const params = (body as Record<string, unknown>).params;
    return { ok: true, version: negotiate(isPlainObject(params) ? params.protocolVersion : undefined) };
  }
  const h = header?.trim();
  if (!h) return { ok: true, version: HEADERLESS_VERSION };
  return isVersion(h) ? { ok: true, version: h } : { ok: false };
}

/** The initialize result (2.3); serverInfo.title only where the version has it. */
export function initializeResult(version: ProtocolVersion): Record<string, unknown> {
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: version === "2025-03-26" ? { name: "workwrk", version: SERVER_VERSION } : { name: "workwrk", title: "WorkwrK", version: SERVER_VERSION },
    instructions: MCP_TOOL_COPY.instructions,
  };
}

async function dispatch(req: Extract<Classified, { kind: "request" }>, env: RpcEnv, inBatch: boolean): Promise<Record<string, unknown>> {
  try {
    switch (req.method) {
      case "initialize":
        if (inBatch) return rpcError(req.id, -32600, MCP_RPC_COPY.invalidRequest, { reason: MCP_RPC_COPY.initInBatch });
        return rpcResult(req.id, initializeResult(env.version));
      case "ping":
        return rpcResult(req.id, {});
      case "tools/list":
        // params.cursor is ignored: every tool is in one answer, with no nextCursor.
        return rpcResult(req.id, { tools: env.listTools() });
      case "tools/call": {
        const p = req.params;
        if (!isPlainObject(p) || typeof p.name !== "string" || !p.name) {
          return rpcError(req.id, -32602, MCP_RPC_COPY.invalidParams, { reason: MCP_RPC_COPY.noToolName });
        }
        const args = p.arguments === undefined || p.arguments === null ? {} : p.arguments;
        if (!isPlainObject(args)) return rpcError(req.id, -32602, MCP_RPC_COPY.invalidParams, { reason: MCP_RPC_COPY.argumentsNotObject });
        return rpcResult(req.id, await env.callTool(p.name, args));
      }
      default:
        return rpcError(req.id, -32601, MCP_RPC_COPY.methodNotFound);
    }
  } catch (err) {
    if (err instanceof RpcError) return rpcError(req.id, err.code, err.message, err.data);
    console.warn(`[mcp] ${req.method === "tools/call" ? "tools_call" : "method"} internal`);
    return rpcError(req.id, -32603, MCP_TOOL_COPY.errors.internal);
  }
}

/** The answer to one message: a response, or null for a notification or a client's response. */
async function answerOne(msg: unknown, env: RpcEnv, inBatch: boolean): Promise<Record<string, unknown> | null> {
  const c = classify(msg);
  if (c.kind === "notification" || c.kind === "response") return null;
  if (c.kind === "invalid") return rpcError(c.id, -32600, MCP_RPC_COPY.invalidRequest);
  return dispatch(c, env, inBatch);
}

/** The HTTP answer to a parsed body: a status and a JSON body, or null with 202. */
export async function answerBody(body: unknown, env: RpcEnv): Promise<{ status: number; body: unknown | null }> {
  if (Array.isArray(body)) {
    if (env.version !== "2025-03-26") return { status: 400, body: rpcError(null, -32600, MCP_RPC_COPY.invalidRequest, { reason: MCP_RPC_COPY.batchVersion }) };
    if (body.length === 0 || body.length > BATCH_MAX) return { status: 400, body: rpcError(null, -32600, MCP_RPC_COPY.invalidRequest, { reason: MCP_RPC_COPY.batchSize }) };
    const out: Record<string, unknown>[] = [];
    for (const msg of body) {
      if (env.admit && !env.admit()) {
        const c = classify(msg);
        if (c.kind === "request") out.push(rpcError(c.id, -32000, MCP_RPC_COPY.tooMany));
        else if (c.kind === "invalid") out.push(rpcError(c.id, -32600, MCP_RPC_COPY.invalidRequest));
        continue;
      }
      const a = await answerOne(msg, env, true);
      if (a) out.push(a);
    }
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }
  const c = classify(body);
  if (c.kind === "invalid") return { status: 400, body: rpcError(c.id, -32600, MCP_RPC_COPY.invalidRequest) };
  const a = await answerOne(body, env, false);
  return a ? { status: 200, body: a } : { status: 202, body: null };
}

/** A parse error's answer (2.1 step 8). */
export function parseErrorBody(): Record<string, unknown> {
  return rpcError(null, -32700, MCP_RPC_COPY.parse);
}
