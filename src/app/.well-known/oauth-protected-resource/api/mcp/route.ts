// GET /.well-known/oauth-protected-resource/api/mcp: the same RFC 9728
// document at the resource's path suffix, which 2025-06-18 clients ask for
// first (docs/plans/mcp-server.md 3.1; the 401 challenge names it).
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
