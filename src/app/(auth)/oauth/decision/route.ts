// POST /oauth/decision: the consent form's Allow or Deny
// (docs/plans/mcp-server.md 3.4; the logic is src/lib/oauth/decision.ts).
// A 404 while MCP_OFFERED is unset. A refusal is a 403 page that moves on to
// the consent page's own sentence; Allow and Deny are a 303 to the app.

import { mcpServes } from "@/lib/mcp/config";
import { decide, redirectResponse, refusalResponse } from "@/lib/oauth/decision";
import { logOAuth, offNotFound, otherMethods } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  try {
    const outcome = await decide(req);
    if (outcome.kind === "redirect") return redirectResponse(outcome.to);
    logOAuth("decision", outcome.view);
    return refusalResponse(outcome);
  } catch {
    logOAuth("decision", "server_error");
    return refusalResponse({ kind: "refuse", status: 500, view: "refused", request: null });
  }
}

export function GET(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}

// Every other method: 404 while MCP_OFFERED is unset, else 405 (never Next's own 405).
const other = otherMethods("POST");
export const HEAD = other.HEAD;
export const PUT = other.PUT;
export const PATCH = other.PATCH;
export const DELETE = other.DELETE;
export const OPTIONS = other.OPTIONS;
