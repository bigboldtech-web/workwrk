// GET /api/me/connected-apps
//
// My settings, Calendar & connections, AI apps (docs/plans/mcp-server.md
// 6.2): the signed-in person's own live AI app connections, in every
// workspace they belong to, each put through the bearer check's standing
// first, so one that no longer stands is revoked with its reason and never
// listed (src/lib/mcp/connected-apps.ts liveGrantsOf). Also the address an
// app connects to and the docs page, for "How to connect one".
//
// A 404 while MCP_OFFERED is unset, reading nothing, so the page draws
// nothing. Every other method answers 405 (404 while unset).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { MCP_DOCS_URL, MCP_RESOURCE, mcpOffered } from "@/lib/mcp/config";
import { liveGrantsOf } from "@/lib/mcp/connected-apps";
import { NO_STORE, offNotFound } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!mcpOffered()) return offNotFound();
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
  const apps = await liveGrantsOf(userId);
  return NextResponse.json({ apps, address: MCP_RESOURCE(), docsUrl: MCP_DOCS_URL() }, { headers: NO_STORE });
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
