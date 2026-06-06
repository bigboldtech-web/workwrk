// GET  /api/me/favorites/folders — hydrated starred Folder list
// POST /api/me/favorites/folders { folderId, on } — toggle
//
// Phase 83. Mirrors /api/me/favorites/boards. Folder visibility
// gates through its parent Space (Phase 22b shape).

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
  const ids: string[] = Array.isArray(effective?.home?.favoriteFolderIds)
    ? (effective.home!.favoriteFolderIds as string[])
    : [];
  if (ids.length === 0) return NextResponse.json({ folders: [] });

  const rows = await prisma.folder.findMany({
    where: { organizationId: u.organizationId, id: { in: ids }, archivedAt: null },
    select: {
      id: true, name: true, icon: true, color: true, spaceId: true,
      space: { select: { slug: true } },
    },
  });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const visible = (await Promise.all(
    rows.map(async (f) => ((await getSpaceForReader(f.spaceId, u.id!, accessLevel)) ? f : null)),
  )).filter((f): f is NonNullable<typeof f> => f !== null);

  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ folders: visible });
}

const bodySchema = z.object({
  folderId: z.string().min(1),
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
  const current: string[] = Array.isArray(effective?.home?.favoriteFolderIds)
    ? (effective.home!.favoriteFolderIds as string[])
    : [];
  const set = new Set(current);
  if (parsed.data.on) set.add(parsed.data.folderId);
  else set.delete(parsed.data.folderId);
  await setUserPreference(u.id, {
    home: { ...(effective?.home ?? {}), favoriteFolderIds: Array.from(set) },
  });
  return NextResponse.json({ favoriteFolderIds: Array.from(set) });
}
