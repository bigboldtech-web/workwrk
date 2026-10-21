// /api/mcp: the WorkwrK MCP server (docs/plans/mcp-server.md 2). A 404
// while MCP_OFFERED is unset, and in production on any host but APP_HOST.
// POST is JSON-RPC (src/lib/mcp/transport.ts); GET and DELETE answer 405;
// OPTIONS is the CORS preflight.

import { handleMcpOptions, handleMcpPost, mcpMethodNotAllowed } from "@/lib/mcp/transport";

export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleMcpPost(req);
}

export function GET(req: Request): Response {
  return mcpMethodNotAllowed(req);
}

export function DELETE(req: Request): Response {
  return mcpMethodNotAllowed(req);
}

export function OPTIONS(req: Request): Response {
  return handleMcpOptions(req);
}
