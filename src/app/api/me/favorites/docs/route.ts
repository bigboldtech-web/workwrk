// GET  /api/me/favorites/docs — hydrated starred Doc list
// POST /api/me/favorites/docs { docId, on } — toggle
//
// Phase 82 (revised). Mirror of /api/me/favorites/boards and /spaces.
// HomePref.favoriteDocIds already exists on the prefs shape.

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
  const ids: string[] = Array.isArray(effective?.home?.favoriteDocIds)
    ? (effective.home!.favoriteDocIds as string[])
    : [];
  if (ids.length === 0) return NextResponse.json({ docs: [] });

  const rows = await prisma.doc.findMany({
    where: { organizationId: u.organizationId, id: { in: ids }, archivedAt: null },
    select: { id: true, title: true, excerpt: true, entityType: true, entityId: true },
  });
  // Starred docs the viewer lost access to (their Space, Folder, List or
  // parent page, or a restriction) silently drop out: one world for every
  // starred doc, from the one resolver.
  const roles = await nodeRoleMap(nodeCtxFromLevel(u.id, u.organizationId, u.accessLevel), "doc", rows.map((d) => d.id));
  const visible = rows.filter((d) => roleAtLeast(roles.get(d.id) ?? "none", "VIEW"));

  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ docs: visible });
}

const bodySchema = z.object({
  docId: z.string().min(1),
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
  const current: string[] = Array.isArray(effective?.home?.favoriteDocIds)
    ? (effective.home!.favoriteDocIds as string[])
    : [];
  const set = new Set(current);
  if (parsed.data.on) set.add(parsed.data.docId);
  else set.delete(parsed.data.docId);
  await setUserHomeKey(u.id, "favoriteDocIds", Array.from(set));
  return NextResponse.json({ favoriteDocIds: Array.from(set) });
}
