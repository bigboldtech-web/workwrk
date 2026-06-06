// GET  /api/me/favorites/spaces — hydrated starred Space list (visibility-gated)
// POST /api/me/favorites/spaces { spaceId, on } — toggle
//
// Phase 80. Mirror of /api/me/favorites/boards.

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
  const ids: string[] = Array.isArray(effective?.home?.favoriteSpaceIds)
    ? (effective.home!.favoriteSpaceIds as string[])
    : [];
  if (ids.length === 0) return NextResponse.json({ spaces: [] });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const rows = await prisma.space.findMany({
    where: { organizationId: u.organizationId, id: { in: ids }, archivedAt: null },
    select: { id: true, slug: true, name: true, icon: true, color: true, visibility: true },
  });
  const visible = (await Promise.all(
    rows.map(async (s) => ((await getSpaceForReader(s.id, u.id!, accessLevel)) ? s : null)),
  )).filter((s): s is NonNullable<typeof s> => s !== null);
  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ spaces: visible });
}

const bodySchema = z.object({
  spaceId: z.string().min(1),
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
  const current: string[] = Array.isArray(effective?.home?.favoriteSpaceIds)
    ? (effective.home!.favoriteSpaceIds as string[])
    : [];
  const set = new Set(current);
  if (parsed.data.on) set.add(parsed.data.spaceId);
  else set.delete(parsed.data.spaceId);
  await setUserPreference(u.id, {
    home: { ...(effective?.home ?? {}), favoriteSpaceIds: Array.from(set) },
  });
  return NextResponse.json({ favoriteSpaceIds: Array.from(set) });
}
