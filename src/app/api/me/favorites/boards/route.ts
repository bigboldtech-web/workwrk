// POST /api/me/favorites/boards { boardId, on } — toggle a board into
// the viewer's favoriteBoardIds list. Persists under UserPreference.home.
//
// Phase 78. Uses the same `home` JSON blob as cards/order so the
// existing /api/preferences GET hydrates favorites alongside the rest
// of the home shell state.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePreferences, setUserHomeKey } from "@/lib/preferences";
import { prisma } from "@/lib/prisma";
import { nodeCtxFromLevel, nodeRoleMap } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const ids: string[] = Array.isArray(effective?.home?.favoriteBoardIds)
    ? (effective.home!.favoriteBoardIds as string[])
    : [];
  if (ids.length === 0) return NextResponse.json({ boards: [] });

  // Pull, then keep the Lists the viewer can still open: one world for every
  // starred List (the one resolver), never a gate call per row.
  const rows = await prisma.board.findMany({
    where: { organizationId: u.organizationId, id: { in: ids }, archivedAt: null },
    select: { id: true, slug: true, name: true, icon: true, color: true, visibility: true, spaceId: true },
  });
  const roles = await nodeRoleMap(nodeCtxFromLevel(u.id, u.organizationId, u.accessLevel), "list", rows.map((b) => b.id));
  const visible = rows.filter((b) => roleAtLeast(roles.get(b.id) ?? "none", "VIEW"));

  // Preserve the user's saved order.
  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ boards: visible });
}

const bodySchema = z.object({
  boardId: z.string().min(1),
  on: z.boolean(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const current: string[] = Array.isArray(effective?.home?.favoriteBoardIds)
    ? (effective.home!.favoriteBoardIds as string[])
    : [];
  const set = new Set(current);
  if (parsed.data.on) set.add(parsed.data.boardId);
  else set.delete(parsed.data.boardId);
  await setUserHomeKey(u.id, "favoriteBoardIds", Array.from(set));
  return NextResponse.json({ favoriteBoardIds: Array.from(set) });
}
