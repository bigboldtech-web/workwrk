// GET  /api/me/favorites/tables — hydrated starred DataTable list
// POST /api/me/favorites/tables { tableId, on } — toggle
//
// Phase 84. Mirrors /api/me/favorites/boards. DataTable visibility
// gates via its optional Space anchor (Phase 32b — null spaceId means
// org-wide and is always visible).

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePreferences, setUserPreference } from "@/lib/preferences";
import { prisma } from "@/lib/prisma";
import { getSpaceForReader } from "@/lib/space";

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
    select: { id: true, name: true, description: true, spaceId: true },
  });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const visible = (await Promise.all(
    rows.map(async (t) => {
      if (!t.spaceId) return t; // org-wide, no gate
      const space = await getSpaceForReader(t.spaceId, u.id!, accessLevel);
      return space ? t : null;
    }),
  )).filter((t): t is NonNullable<typeof t> => t !== null);

  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ tables: visible });
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
  await setUserPreference(u.id, {
    home: { ...(effective?.home ?? {}), favoriteTableIds: Array.from(set) },
  });
  return NextResponse.json({ favoriteTableIds: Array.from(set) });
}
