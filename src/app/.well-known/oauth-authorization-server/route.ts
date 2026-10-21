// GET /.well-known/oauth-authorization-server: RFC 8414 authorization server
// metadata (docs/plans/mcp-server.md 3.2). The app host only; a 404 while
// MCP_OFFERED is unset. /.well-known/openid-configuration stays a 404.
import { mcpServes } from "@/lib/mcp/config";
import { authorizationServerMetadata, metadataPreflight, metadataResponse } from "@/lib/oauth/metadata";
import { offNotFound } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return metadataResponse(authorizationServerMetadata());
}

export function OPTIONS(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return metadataPreflight();
}
