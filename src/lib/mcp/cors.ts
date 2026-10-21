// Who may call /api/mcp from a browser, and the CORS answers
// (docs/plans/mcp-server.md 2.1 step 2, 3.11; risks 15 and 16).
//
// THE ORIGIN CHECK comes before anything reads a credential. A request is
// served when it carries no Origin (a native app, a server, Claude Code), or
// the app's own origin (MCP_ORIGIN), or one listed in MCP_ALLOWED_ORIGINS
// (comma separated, compared as origins), or, outside production only, a
// loopback origin (http or https on localhost, 127.0.0.1 or [::1], any
// port). Anything else is refused 403 and its host is logged, the one place
// a log line names something a caller sent. It stops a page on another site
// driving the endpoint with a token it holds, and DNS rebinding (with the
// production Host check).
//
// THE ANSWERS: an allowed Origin is echoed with Vary: Origin, the headers a
// client sends are allowed (Authorization, Content-Type, Accept,
// MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID), WWW-Authenticate and
// MCP-Protocol-Version are exposed, and credentials are never allowed. The
// OAuth endpoints' CORS is src/lib/oauth/oauth-errors.ts OAUTH_CORS: `*`,
// never credentials.
//
// Pure (reads the configuration).

import { mcpOrigin } from "./config";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const MCP_CORS_ALLOW_HEADERS = "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID";
export const MCP_CORS_EXPOSE_HEADERS = "WWW-Authenticate, MCP-Protocol-Version";
export const MCP_CORS_ALLOW_METHODS = "POST, OPTIONS";

function originOf(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The origins MCP_ALLOWED_ORIGINS lists, as origins. */
export function allowedOriginsList(): string[] {
  return (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => (s.trim() ? originOf(s) : null))
    .filter((s): s is string => !!s);
}

export type OriginVerdict = { kind: "absent" } | { kind: "allowed"; origin: string } | { kind: "refused"; host: string };

/** 2.1 step 2 for one Origin header. */
export function checkOrigin(header: string | null | undefined): OriginVerdict {
  if (header === null || header === undefined || header === "") return { kind: "absent" };
  const origin = originOf(header);
  if (!origin) return { kind: "refused", host: "invalid" };
  const host = new URL(origin).hostname;
  if (origin === mcpOrigin()) return { kind: "allowed", origin };
  if (allowedOriginsList().includes(origin)) return { kind: "allowed", origin };
  if (process.env.NODE_ENV !== "production" && LOOPBACK_HOSTS.has(host)) return { kind: "allowed", origin };
  return { kind: "refused", host: host.slice(0, 255) };
}

/** The CORS headers an answer to this Origin carries: none for no Origin or a refused one. */
export function mcpCorsHeaders(v: OriginVerdict): Record<string, string> {
  if (v.kind !== "allowed") return {};
  return {
    "Access-Control-Allow-Origin": v.origin,
    "Access-Control-Expose-Headers": MCP_CORS_EXPOSE_HEADERS,
    Vary: "Origin",
  };
}

/** The preflight answer (OPTIONS): 204 for an allowed Origin, 403 with no CORS headers for a refused one. */
export function mcpPreflight(v: OriginVerdict): Response {
  if (v.kind === "refused") {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store", Vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      ...(v.kind === "allowed"
        ? {
            "Access-Control-Allow-Origin": v.origin,
            "Access-Control-Allow-Methods": MCP_CORS_ALLOW_METHODS,
            "Access-Control-Allow-Headers": MCP_CORS_ALLOW_HEADERS,
            "Access-Control-Expose-Headers": MCP_CORS_EXPOSE_HEADERS,
            "Access-Control-Max-Age": "600",
            Vary: "Origin",
          }
        : { Allow: MCP_CORS_ALLOW_METHODS }),
    },
  });
}
