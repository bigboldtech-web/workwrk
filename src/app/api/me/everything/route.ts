// GET /api/me/everything — the workspace-wide All Tasks feed. Every
// Item the caller can read across all boards/spaces of their org,
// newest first, capped at 500. Per-board visibility composes through
// getBoardForReader inside listEverythingItems, so items in boards the
// viewer can't see silently drop (same pattern as /api/me/items).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listEverythingItems } from "@/lib/everything";

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await listEverythingItems(u.organizationId, u.id, u.accessLevel ?? "EMPLOYEE");
  return NextResponse.json({ items });
}
