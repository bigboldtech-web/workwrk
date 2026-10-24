// /.well-known/openid-configuration: always a 404, for every method
// (docs/plans/mcp-server.md 3.1, "/.well-known/openid-configuration stays
// 404"). WorkwrK's OAuth server serves the MCP server only (RFC 8414 at
// /.well-known/oauth-authorization-server); it is not an OpenID Connect
// provider, and a client that probes for one must be told plainly that
// there is none.
//
// Without this route the path fell through to the app's catch-all page
// ((dashboard)/[...rest]), which answers a signed-out visitor 200 with a
// redirect to /login inside the streamed page, and a signed-in one 200 with
// the in-shell 404: a discovery client read a 200 HTML answer where the spec
// says 404 (found by the live proof, scripts/live-proof-mcp.ts M1). The
// answer is the same whether MCP_OFFERED is set or not: nothing here says
// whether the MCP server exists.

import { offNotFound } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

function notHere(): Response {
  return offNotFound();
}

export const GET = notHere;
export const HEAD = notHere;
export const POST = notHere;
export const PUT = notHere;
export const PATCH = notHere;
export const DELETE = notHere;
export const OPTIONS = notHere;
