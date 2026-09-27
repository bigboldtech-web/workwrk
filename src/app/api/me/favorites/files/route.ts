// GET  /api/me/favorites/files — hydrated starred FileEntry list
// POST /api/me/favorites/files { fileId, on } — toggle
//
// Phase 89. FileEntry visibility-gates via its parent Space (Phase 22).

import { NextResponse } from "next/server";
import { withFreshFileUrls } from "@/lib/file-urls";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePreferences, setUserHomeKey } from "@/lib/preferences";
import { prisma } from "@/lib/prisma";
import { readableFileRows } from "@/lib/file-access";

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const ids: string[] = Array.isArray(effective?.home?.favoriteFileIds)
    ? (effective.home!.favoriteFileIds as string[])
    : [];
  if (ids.length === 0) return NextResponse.json({ files: [] });

  const rows = await prisma.fileEntry.findMany({
    where: { organizationId: u.organizationId, id: { in: ids } },
    select: { id: true, name: true, mimeType: true, size: true, url: true, s3Key: true, spaceId: true, spaceFolderId: true },
  });
  // The file read rule (src/lib/file-access.ts): a Space folder's files by
  // that Folder, a Space's files by that Space, one world for the batch.
  const visible = await readableFileRows(rows, { organizationId: u.organizationId, userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE" });

  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const fresh = await withFreshFileUrls(visible);
  return NextResponse.json({ files: fresh });
}

const bodySchema = z.object({
  fileId: z.string().min(1),
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
  const current: string[] = Array.isArray(effective?.home?.favoriteFileIds)
    ? (effective.home!.favoriteFileIds as string[])
    : [];
  const set = new Set(current);
  if (parsed.data.on) set.add(parsed.data.fileId);
  else set.delete(parsed.data.fileId);
  await setUserHomeKey(u.id, "favoriteFileIds", Array.from(set));
  return NextResponse.json({ favoriteFileIds: Array.from(set) });
}
