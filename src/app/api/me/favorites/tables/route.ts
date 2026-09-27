// GET  /api/me/favorites/tables, hydrated starred DataTable list
// POST /api/me/favorites/tables { tableId, on }, toggle
// DELETE /api/me/favorites/tables?tableId=, un-star (the same write as on:false)
//
// Phase 84. Mirrors /api/me/favorites/boards. DataTable visibility
// gates via its optional Space anchor (Phase 32b, null spaceId means
// org-wide and is always visible).

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
  const ids: string[] = Array.isArray(effective?.home?.favoriteTableIds)
    ? (effective.home!.favoriteTableIds as string[])
    : [];
  if (ids.length === 0) return NextResponse.json({ tables: [] });

  const rows = await prisma.dataTable.findMany({
    where: { organizationId: u.organizationId, id: { in: ids } },
    select: { id: true, name: true, description: true, spaceId: true, createdById: true },
  });
  // One world for every starred table (the one resolver, R7): a Space's
  // readers, the unscoped rule (org-wide for Members, a Guest's own only),
  // the creator and a table grant.
  const roles = await nodeRoleMap(nodeCtxFromLevel(u.id, u.organizationId, u.accessLevel), "table", rows.map((t) => t.id));
  const visible = rows.filter((t) => roleAtLeast(roles.get(t.id) ?? "none", "VIEW"));

  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  // createdById is read for the Guest rule only; the response keeps its shape.
  return NextResponse.json({ tables: visible.map((t) => ({ id: t.id, name: t.name, description: t.description, spaceId: t.spaceId })) });
}

const bodySchema = z.object({
  tableId: z.string().min(1),
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
  const current: string[] = Array.isArray(effective?.home?.favoriteTableIds)
    ? (effective.home!.favoriteTableIds as string[])
    : [];
  const set = new Set(current);
  if (parsed.data.on) set.add(parsed.data.tableId);
  else set.delete(parsed.data.tableId);
  await setUserHomeKey(u.id, "favoriteTableIds", Array.from(set));
  return NextResponse.json({ favoriteTableIds: Array.from(set) });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tableId = new URL(req.url).searchParams.get("tableId")?.trim();
  if (!tableId) return NextResponse.json({ error: "tableId required" }, { status: 400 });
  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const current: string[] = Array.isArray(effective?.home?.favoriteTableIds)
    ? (effective.home!.favoriteTableIds as string[])
    : [];
  const next = current.filter((id) => id !== tableId);
  await setUserHomeKey(u.id, "favoriteTableIds", next);
  return NextResponse.json({ favoriteTableIds: next });
}
