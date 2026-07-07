// PATCH  /api/folders/[id] — rename / re-parent / re-position
// DELETE /api/folders/[id] — archive (soft); ?hard=1 → recoverable Trash

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { archiveFolder, updateFolder } from "@/lib/folder";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { moveToTrash } from "@/lib/trash";
import { prisma } from "@/lib/prisma";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string; name?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId, userName: u.name ?? null };
}

async function loadFolderAndGate(folderId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true, spaceId: true, organizationId: true },
  });
  if (!folder || folder.organizationId !== c.organizationId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const space = await getSpaceForReader(folder.spaceId, c.userId, c.accessLevel);
  if (!space) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const canEdit = await canEditSpace(folder.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { folder };
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  spaceId: z.string().min(1).optional(),
  parentFolderId: z.string().min(1).nullable().optional(),
  position: z.number().finite().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadFolderAndGate(id, c);
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const updated = await updateFolder(id, parsed.data);
    return NextResponse.json({ folder: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update folder" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadFolderAndGate(id, c);
  if ("error" in gate) return gate.error;
  const hard = new URL(req.url).searchParams.get("hard") === "1";
  if (hard) {
    // Recoverable delete — snapshot the folder + its lists to Trash.
    await moveToTrash("folder", id, { organizationId: c.organizationId, userId: c.userId, userName: c.userName });
    return NextResponse.json({ ok: true });
  }
  const archived = await archiveFolder(id);
  return NextResponse.json({ folder: archived });
}
