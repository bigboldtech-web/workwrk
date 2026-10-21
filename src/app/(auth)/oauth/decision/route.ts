// POST /oauth/decision: the consent form's Allow or Deny
// (docs/plans/mcp-server.md 3.4; the logic is src/lib/oauth/decision.ts).
// A 404 while MCP_OFFERED is unset. A refusal is a 403 page that moves on to
// the consent page's own sentence; Allow and Deny are a 303 to the app.

import { mcpServes } from "@/lib/mcp/config";
import { decide, redirectResponse, refusalResponse } from "@/lib/oauth/decision";
import { logOAuth, offNotFound } from "@/lib/oauth/oauth-errors";

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
