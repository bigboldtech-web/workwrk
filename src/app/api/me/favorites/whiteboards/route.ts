// GET  /api/me/favorites/whiteboards — hydrated starred Whiteboard list
// POST /api/me/favorites/whiteboards { whiteboardId, on } — toggle
//
// Phase 89. Whiteboards visibility-gate through their parent Space
// (Phase 22 pattern). Org-wide whiteboards (no spaceId) stay visible.

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
  const ids: string[] = Array.isArray(effective?.home?.favoriteWhiteboardIds)
    ? (effective.home!.favoriteWhiteboardIds as string[])
    : [];
  if (ids.length === 0) return NextResponse.json({ whiteboards: [] });

  const rows = await prisma.whiteboard.findMany({
    where: { organizationId: u.organizationId, id: { in: ids } },
    select: { id: true, name: true, description: true, spaceId: true },
  });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const visible = (await Promise.all(
    rows.map(async (w) => {
      if (!w.spaceId) return w;
      const space = await getSpaceForReader(w.spaceId, u.id!, accessLevel);
      return space ? w : null;
    }),
  )).filter((w): w is NonNullable<typeof w> => w !== null);

  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ whiteboards: visible });
}

const bodySchema = z.object({
  whiteboardId: z.string().min(1),
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
  const current: string[] = Array.isArray(effective?.home?.favoriteWhiteboardIds)
    ? (effective.home!.favoriteWhiteboardIds as string[])
    : [];
  const set = new Set(current);
  if (parsed.data.on) set.add(parsed.data.whiteboardId);
  else set.delete(parsed.data.whiteboardId);
  await setUserPreference(u.id, {
    home: { ...(effective?.home ?? {}), favoriteWhiteboardIds: Array.from(set) },
  });
  return NextResponse.json({ favoriteWhiteboardIds: Array.from(set) });
}
