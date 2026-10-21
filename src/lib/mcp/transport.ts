// /api/mcp over HTTP: Streamable HTTP answered with JSON, stateless, no
// library (docs/plans/mcp-server.md Decision 1, 2.1). A POST passes these
// checks in this order, and the first that fails answers:
//
//   1. MCP_OFFERED, and in production the Host is APP_HOST        404
//   2. the Origin: absent, ours, or allowed (cors.ts); before any
//      credential is read                                           403
//   3. Content-Type's media type is application/json (any charset)  415
//   4. Accept is absent, or allows application/json                 406
//   5. the body is at most 262,144 bytes                            413
//   6. only without a well-formed credential: 120 a minute per
//      address                                                      429
//   7. the token (auth.ts, 3.8); cookies and query tokens ignored    401
//   8. the body is JSON                                             400 -32700
//   9. MCP-Protocol-Version, for anything but a lone initialize     400 -32600
//  10. 120 a minute per connection, 240 per person                  429 -32000
//
// Then the JSON-RPC answer (protocol.ts). GET and DELETE answer 405 with
// Allow: POST, OPTIONS (no stream, no session to end); OPTIONS is the CORS
// preflight. Every answer carries Cache-Control: no-store, and none ever
// carries an Mcp-Session-Id or sets a cookie.
//
// Logs carry codes only: `[mcp] <op> <code>`, and a refused Origin's host.
//
// Server-only.

import { mediaType } from "@/lib/oauth/form";
import { offNotFound } from "@/lib/oauth/oauth-errors";
import { ipFromRequest } from "@/lib/rate-limit-memory";
import { challenge, hasWellFormedCredential, mcpContext } from "./auth";
import { mcpServes } from "./config";
import { checkOrigin, mcpCorsHeaders, mcpPreflight, MCP_CORS_ALLOW_METHODS } from "./cors";
import { mcpAnonLimit, mcpConnectionLimit } from "./limits";
import { MCP_RPC_COPY as C, MCP_TOOL_COPY } from "./mcp-copy";
import { answerBody, parseErrorBody, rpcError, versionOf, type RpcEnv, type RpcId } from "./protocol";
import { listTools, runTool } from "./registry";

/** The largest body read (2.1 step 5). */
export const BODY_MAX = 262_144;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function answer(status: number, body: unknown | null, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { "Content-Type": "application/json; charset=utf-8" }), ...NO_STORE, ...headers },
  });
}

/** 2.1 step 4: absent, or a type that takes JSON. */
export function acceptsJson(header: string | null | undefined): boolean {
  if (!header || !header.trim()) return true;
  return header
    .split(",")
    .map((t) => t.split(";")[0].trim().toLowerCase())
    .some((t) => t === "application/json" || t === "*/*" || t === "application/*");
}

type BodyRead = { kind: "large" } | { kind: "text"; text: string | null };

/** The body as UTF-8, read up to the cap and no further, whatever Content-Length says; null when it is not UTF-8 or the stream broke. */
async function readBody(req: Request, cap: number): Promise<BodyRead> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > cap) return { kind: "large" };
  if (!req.body) return { kind: "text", text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => {});
        return { kind: "large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "text", text: null };
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(all) };
  } catch {
    return { kind: "text", text: null };
  }
}

/** The id of a lone request, for an error that answers it; null otherwise. */
function idOf(body: unknown): RpcId | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id)) ? id : null;
}

function retry(seconds: number): Record<string, string> {
  return { "Retry-After": String(Math.max(1, Math.ceil(seconds))) };
}

/** POST /api/mcp. */
export async function handleMcpPost(req: Request): Promise<Response> {
  // 1. Offered, on the app host.
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  // 2. The Origin, before any credential is read.
  const origin = checkOrigin(req.headers.get("origin"));
  if (origin.kind === "refused") {
    console.warn(`[mcp] origin refused ${origin.host}`);
    return answer(403, rpcError(null, -32600, C.origin), { Vary: "Origin" });
  }
  const cors = mcpCorsHeaders(origin);
  try {
    // 3 to 5. The body's type, what the client accepts, the size.
    if (mediaType(req.headers.get("content-type")) !== "application/json") return answer(415, rpcError(null, -32600, C.contentType), cors);
    if (!acceptsJson(req.headers.get("accept"))) return answer(406, rpcError(null, -32600, C.accept), cors);
    const body = await readBody(req, BODY_MAX);
    if (body.kind === "large") return answer(413, rpcError(null, -32600, C.tooLarge), cors);
    // 6. An address is counted only when no well-formed credential is sent.
    const authorization = req.headers.get("authorization");
    if (!hasWellFormedCredential(authorization)) {
      const l = mcpAnonLimit(ipFromRequest(req));
      if (!l.ok) {
        console.warn("[mcp] limit anon");
        return answer(429, rpcError(null, -32000, C.tooMany), { ...cors, ...retry(l.retryAfter) });
      }
    }
    // 7. The token.
    const auth = await mcpContext(authorization);
    if (!auth.ok) return challenge(auth.sent, cors);
    // 8. JSON.
    let parsed: unknown;
    try {
      if (body.text === null) throw new Error("not utf-8");
      parsed = JSON.parse(body.text);
    } catch {
      return answer(400, parseErrorBody(), cors);
    }
    // 9. The version, for anything but a lone initialize.
    const v = versionOf(req.headers.get("mcp-protocol-version"), parsed);
    if (!v.ok) return answer(400, rpcError(idOf(parsed), -32600, C.version), cors);
    // 10. The connection's and the person's limits.
    const lim = mcpConnectionLimit(auth.ctx.grant.id, auth.ctx.grant.userId);
    if (!lim.ok) {
      console.warn("[mcp] limit connection");
      return answer(429, rpcError(idOf(parsed), -32000, C.tooMany), { ...cors, ...retry(lim.retryAfter) });
    }
    const env: RpcEnv = {
      version: v.version,
      listTools: () => listTools(auth.ctx.scopes, v.version),
      callTool: (name, args) => runTool(auth.ctx, v.version, name, args),
    };
    const out = await answerBody(parsed, env);
    return answer(out.status, out.body, { ...cors, "MCP-Protocol-Version": v.version });
  } catch {
    console.warn("[mcp] request internal");
    return answer(500, rpcError(null, -32603, MCP_TOOL_COPY.errors.internal), cors);
  }
}

/** GET and DELETE /api/mcp: no stream and no session, so 405. */
export function mcpMethodNotAllowed(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return new Response(null, { status: 405, headers: { Allow: MCP_CORS_ALLOW_METHODS, ...NO_STORE } });
}

/** OPTIONS /api/mcp: the CORS preflight. */
export function handleMcpOptions(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  const v = checkOrigin(req.headers.get("origin"));
  if (v.kind === "refused") console.warn(`[mcp] origin refused ${v.host}`);
  return mcpPreflight(v);
}
