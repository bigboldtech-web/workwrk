// GET /.well-known/oauth-protected-resource: RFC 9728 protected resource
// metadata (docs/plans/mcp-server.md 3.2). The app host only; a 404 while
// MCP_OFFERED is unset. The same document answers at the "/api/mcp" suffix.
import { mcpServes } from "@/lib/mcp/config";
import { metadataPreflight, metadataResponse, protectedResourceMetadata } from "@/lib/oauth/metadata";
import { offNotFound } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return metadataResponse(protectedResourceMetadata());
}

export function OPTIONS(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return metadataPreflight();
}
