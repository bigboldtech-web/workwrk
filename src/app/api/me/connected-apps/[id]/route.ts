// DELETE /api/me/connected-apps/[id]
//
// Disconnect (docs/plans/mcp-server.md 6.2, 3.9 "The person disconnects"):
// the signed-in person's own AI app connection ends at once, reason
// "person": its tokens are revoked with it, and one mcp.app.revoked audit
// row, which their security activity lists, says so
// (src/lib/mcp/connected-apps.ts disconnectApp). Another person's id, or a
// connection already ended, is a 404 that changes nothing.
//
// A 404 while MCP_OFFERED is unset, reading nothing. Every other method
// answers 405 (404 while unset).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { mcpOffered } from "@/lib/mcp/config";
import { disconnectApp } from "@/lib/mcp/connected-apps";
import { MCP_CONNECTED_COPY as C } from "@/lib/mcp/mcp-copy";
import { NO_STORE, offNotFound } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  if (!mcpOffered()) return offNotFound();
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  if (!(await disconnectApp(userId, id))) return NextResponse.json({ error: C.notFound, code: "not_found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ disconnected: true }, { headers: NO_STORE });
}

/** Every other method: 404 while MCP_OFFERED is unset, else 405 (never Next's own 405). */
function other(): Response {
  if (!mcpOffered()) return offNotFound();
  return new Response(null, { status: 405, headers: { Allow: "DELETE", ...NO_STORE } });
}
export const GET = other;
export const HEAD = other;
export const POST = other;
export const PUT = other;
export const PATCH = other;
export const OPTIONS = other;
