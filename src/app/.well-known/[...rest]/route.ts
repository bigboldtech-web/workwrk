// Every other /.well-known/ path: a bare 404, for every method, whether MCP
// is offered or not (final review of the MCP server, contract L4).
//
// Without this route an unknown path, such as
// /.well-known/oauth-authorization-server/api/mcp (the RFC 8414 path a
// client builds by inserting the well-known part before the issuer's path),
// fell through to the app's catch-all page ((dashboard)/[...rest]), which
// answers 200 with HTML: a discovery client read a page where it needed a
// plain "not here". The well-known documents WorkwrK serves keep their own
// routes (oauth-authorization-server, oauth-protected-resource and its
// /api/mcp, openid-configuration's 404); a static segment always wins over
// this catch-all, so none of them is shadowed. Nothing here says whether
// the MCP server exists.

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
