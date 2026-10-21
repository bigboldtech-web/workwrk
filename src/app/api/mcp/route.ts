// /api/mcp: the WorkwrK MCP server (docs/plans/mcp-server.md 2). A 404
// while MCP_OFFERED is unset, and in production on any host but APP_HOST,
// for every method. POST is JSON-RPC (src/lib/mcp/transport.ts); OPTIONS is
// the CORS preflight; every other method answers 405 (no stream, no session
// to end), with the CORS headers for an allowed Origin.

import { handleMcpOptions, handleMcpPost, mcpMethodNotAllowed } from "@/lib/mcp/transport";

export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleMcpPost(req);
}

export function OPTIONS(req: Request): Response {
  return handleMcpOptions(req);
}

export const GET = mcpMethodNotAllowed;
export const HEAD = mcpMethodNotAllowed;
export const PUT = mcpMethodNotAllowed;
export const PATCH = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
