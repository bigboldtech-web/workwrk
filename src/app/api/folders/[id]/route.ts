// PATCH  /api/folders/[id] — rename / re-parent / re-position
// DELETE /api/folders/[id] — archive (soft); ?hard=1 → recoverable Trash

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { archiveFolder, updateFolder } from "@/lib/folder";
import { moveToTrash } from "@/lib/trash";
import { prisma } from "@/lib/prisma";
import { moveAllowed, nodeCtxFromLevel, nodeRole } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { recordGeneralAccessChange } from "@/lib/access/grants";

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

// FULL ACCESS ON THE FOLDER ITSELF (W2), never the Space's rights: a Full
// holder of a Folder renames, moves, restricts and deletes it, and a Space
// manager named on a PRIVATE folder keeps managing it through the lift. A
// viewer with no role on the Folder gets the same 404 its page answers, so a
// PRIVATE folder can be neither probed nor flipped to WORKSPACE through here.
async function loadFolderAndGate(folderId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true, spaceId: true, organizationId: true, visibility: true },
  });
  if (!folder || folder.organizationId !== c.organizationId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const ctx = nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel);
  const d = await nodeRole(ctx, { kind: "folder", id: folderId });
  if (d.role === "none") return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!roleAtLeast(d.role, "FULL")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { folder, ctx };
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  spaceId: z.string().min(1).optional(),
  parentFolderId: z.string().min(1).nullable().optional(),
  position: z.number().finite().optional(),
  // access-model Broken #10: the one-way Restricted switch. PRIVATE is
  // "Restricted" in the share dialog, WORKSPACE is "Inherits from the Space".
  visibility: z.enum(["PRIVATE", "WORKSPACE", "ORG"]).optional(),
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
  // A re-parent or a Space change through PATCH follows the move rule: Full
  // access on the destination Folder, or on the destination Space at its root.
  if (parsed.data.parentFolderId !== undefined || parsed.data.spaceId !== undefined) {
    const dest = parsed.data.parentFolderId
      ? { kind: "folder" as const, id: parsed.data.parentFolderId }
      : { kind: "space" as const, id: parsed.data.spaceId ?? gate.folder.spaceId };
    if (!(await moveAllowed(gate.ctx, { kind: "folder", id }, dest))) {
      return NextResponse.json({ error: "You need Full access where this folder is going." }, { status: 403 });
    }
  }
  try {
    const before = gate.folder.visibility;
    const updated = await prisma.$transaction(async (tx) => {
      const row = await updateFolder(id, parsed.data, tx);
      if (parsed.data.visibility !== undefined && parsed.data.visibility !== before) {
        await recordGeneralAccessChange(tx, { userId: c.userId, organizationId: c.organizationId }, { kind: "folder", id }, { visibility: { from: before, to: parsed.data.visibility } });
      }
      return row;
    });
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
  const archived = await archiveFolder(id, c.userId);
  return NextResponse.json({ folder: archived });
}
