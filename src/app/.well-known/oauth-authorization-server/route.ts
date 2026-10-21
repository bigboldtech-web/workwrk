// GET /.well-known/oauth-authorization-server: RFC 8414 authorization server
// metadata (docs/plans/mcp-server.md 3.2). The app host only; a 404 while
// MCP_OFFERED is unset. /.well-known/openid-configuration stays a 404.
import { mcpServes } from "@/lib/mcp/config";
import { authorizationServerMetadata, metadataPreflight, metadataResponse } from "@/lib/oauth/metadata";
import { offNotFound, otherMethods } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return metadataResponse(authorizationServerMetadata());
}

export function OPTIONS(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return metadataPreflight();
}

/** HEAD: the GET's answer without its body (a 404 while MCP_OFFERED is unset). */
export function HEAD(req: Request): Response {
  const r = GET(req);
  return new Response(null, { status: r.status, headers: r.headers });
}

// Every other method: 404 while MCP_OFFERED is unset, else 405 (never Next's own 405).
const other = otherMethods("GET, HEAD, OPTIONS");
export const POST = other.POST;
export const PUT = other.PUT;
export const PATCH = other.PATCH;
export const DELETE = other.DELETE;
