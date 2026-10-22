// GET /api/me/connected-apps/[id]/activity
//
// "Show changes" (docs/plans/mcp-server.md 6.2): the newest changes one of
// the signed-in person's own AI app connections made, from its audit rows
// (mcp.tool.<tool>, metadata.grantId the connection): what it did, when,
// and a link to the task or doc it changed. Never a title or what was
// written. Another person's id, or a connection already ended, is a 404.
//
// A 404 while MCP_OFFERED is unset, reading nothing. Every other method
// answers 405 (404 while unset).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { mcpOffered } from "@/lib/mcp/config";
import { connectedAppChanges } from "@/lib/mcp/connected-apps";
import { MCP_CONNECTED_COPY as C } from "@/lib/mcp/mcp-copy";
import { NO_STORE, offNotFound } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!mcpOffered()) return offNotFound();
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const out = await connectedAppChanges(userId, id);
  if (!out) return NextResponse.json({ error: C.notFound, code: "not_found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(out, { headers: NO_STORE });
}

/** Every other method: 404 while MCP_OFFERED is unset, else 405 (never Next's own 405). */
function other(): Response {
  if (!mcpOffered()) return offNotFound();
  return new Response(null, { status: 405, headers: { Allow: "GET", ...NO_STORE } });
}
export const HEAD = other;
export const POST = other;
export const PUT = other;
export const PATCH = other;
export const DELETE = other;
export const OPTIONS = other;
