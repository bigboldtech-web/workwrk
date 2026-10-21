// /api/mcp over HTTP: Streamable HTTP answered with JSON, stateless, no
// library (docs/plans/mcp-server.md Decision 1, 2.1). A POST passes these
// checks in this order, and the first that fails answers:
//
//   1. MCP_OFFERED, and in production the Host is APP_HOST        404
//   2. the Origin: absent, ours, or allowed (cors.ts); before any
//      credential is read                                           403
//   3. Content-Type's media type is application/json (any charset)  415
//   4. Accept is absent, or allows application/json                 406
//   5. a well-formed credential ("Bearer wkmcp_at_" and 43
//      base64url characters); without one, the 401 challenge at
//      once, before the body is read, and never a 429               401
//   6. the token (auth.ts, 3.8), before the body is read; cookies
//      and query tokens ignored                                     401
//      a failed lookup of a token that names no token is counted
//      for the address; past 120 a minute, such a failure answers
//      429 (a valid token is never counted, and never refused for
//      what strangers on its address do)                            429
//   7. the body is at most 262,144 bytes                            413
//   8. the body is JSON                                             400 -32700
//   9. MCP-Protocol-Version, for anything but a lone initialize     400 -32600
//  10. 120 messages a minute per connection, 240 per person: a lone
//      message is refused 429; a batch is charged per message, each
//      one over answers -32000, and a batch with none admitted is 429
//
// Review of step 2: a token-less request is how every hosted connector
// discovers the authorization server, often from one shared egress address,
// so it is answered the challenge, cheaply, and never refused (M3); and a
// 2025-03-26 batch is charged per message, so it is no way round the minute
// limits (M1).
//
// Then the JSON-RPC answer (protocol.ts). Every other method answers 405
// with Allow: POST, OPTIONS (no stream, no session to end), with the CORS
// headers for an allowed Origin; OPTIONS is the CORS preflight. Every
// answer carries Cache-Control: no-store, and none ever carries an
// Mcp-Session-Id or sets a cookie.
//
// Logs carry codes only: `[mcp] <op> <code>`, and a refused Origin's host.
//
// Server-only.

import { mediaType } from "@/lib/oauth/form";
import { offNotFound } from "@/lib/oauth/oauth-errors";
import { ipFromRequest } from "@/lib/rate-limit-memory";
import { bearerOf, challenge, mcpContext } from "./auth";
import { mcpServes } from "./config";
import { checkOrigin, mcpCorsHeaders, mcpPreflight, MCP_CORS_ALLOW_METHODS } from "./cors";
import { mcpConnectionLimit, unknownTokenBlocked, unknownTokenFailed } from "./limits";
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
    // 3, 4. The body's type, and what the client accepts.
    if (mediaType(req.headers.get("content-type")) !== "application/json") return answer(415, rpcError(null, -32600, C.contentType), cors);
    if (!acceptsJson(req.headers.get("accept"))) return answer(406, rpcError(null, -32600, C.accept), cors);
    // 5. No well-formed credential: the challenge, before the body is read.
    const authorization = req.headers.get("authorization");
    const bearer = bearerOf(authorization);
    if (bearer.kind !== "token") return challenge(bearer.kind === "malformed", cors);
    // 6. The token, before the body. A token that names no token is counted
    // for its address; an address past its limit is answered 429 for it.
    const auth = await mcpContext(authorization);
    if (!auth.ok) {
      if (auth.unknown) {
        const ip = ipFromRequest(req);
        const over = unknownTokenBlocked(ip);
        unknownTokenFailed(ip);
        if (!over.ok) {
          console.warn("[mcp] limit unknown_tokens");
          return answer(429, rpcError(null, -32000, C.tooMany), { ...cors, ...retry(over.retryAfter) });
        }
      }
      return challenge(auth.sent, cors);
    }
    // 7. The size.
    const body = await readBody(req, BODY_MAX);
    if (body.kind === "large") return answer(413, rpcError(null, -32600, C.tooLarge), cors);
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
    // 10. The connection's and the person's limits, per message.
    const charge = () => mcpConnectionLimit(auth.ctx.grant.id, auth.ctx.grant.userId);
    const batch = Array.isArray(parsed);
    if (!batch) {
      const lim = charge();
      if (!lim.ok) {
        console.warn("[mcp] limit connection");
        return answer(429, rpcError(idOf(parsed), -32000, C.tooMany), { ...cors, ...retry(lim.retryAfter) });
      }
    }
    let refusedItems = 0;
    let retryAfter = 0;
    const env: RpcEnv = {
      version: v.version,
      listTools: () => listTools(auth.ctx.scopes, v.version),
      callTool: (name, args) => runTool(auth.ctx, v.version, name, args),
      ...(batch
        ? {
            admit: () => {
              const lim = charge();
              if (!lim.ok) {
                refusedItems += 1;
                retryAfter = Math.max(retryAfter, lim.retryAfter);
              }
              return lim.ok;
            },
          }
        : {}),
    };
    const out = await answerBody(parsed, env);
    if (refusedItems > 0) {
      console.warn("[mcp] limit connection");
      // Not one message admitted: the batch as a whole is refused, with when to try again.
      if (refusedItems === (parsed as unknown[]).length) return answer(429, rpcError(null, -32000, C.tooMany), { ...cors, ...retry(retryAfter) });
    }
    return answer(out.status, out.body, { ...cors, "MCP-Protocol-Version": v.version, ...(refusedItems > 0 ? retry(retryAfter) : {}) });
  } catch {
    console.warn("[mcp] request internal");
    return answer(500, rpcError(null, -32603, MCP_TOOL_COPY.errors.internal), cors);
  }
}

/** Every method but POST and OPTIONS: no stream and no session, so 405, with the CORS headers for an allowed Origin. */
export function mcpMethodNotAllowed(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  const cors = mcpCorsHeaders(checkOrigin(req.headers.get("origin")));
  return new Response(null, { status: 405, headers: { Allow: MCP_CORS_ALLOW_METHODS, ...NO_STORE, ...cors } });
}

/** OPTIONS /api/mcp: the CORS preflight. */
export function handleMcpOptions(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  const v = checkOrigin(req.headers.get("origin"));
  if (v.kind === "refused") console.warn(`[mcp] origin refused ${v.host}`);
  return mcpPreflight(v);
}
