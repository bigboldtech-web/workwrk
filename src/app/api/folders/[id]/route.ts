// PATCH  /api/folders/[id]: rename, re-parent, re-position, restrict
// DELETE /api/folders/[id]: archive (soft); ?hard=1 moves it to Trash
//
// The placement rule (node-rules P1 to P7): a new parent or a `spaceId` goes
// through the one move helper (node-placement moveFolder), which takes the
// Space from the parent and carries the whole subtree in one transaction. A
// `spaceId` is never written as a field of its own (P3): it is checked
// against the parent the Folder ends under (the one named, else the one it
// has), and one that disagrees is a 400 with nothing written. For a Folder at
// a Space's root, the Space named is the root it goes to. Writing it straight
// through is how a sub-folder once jumped to another Space's root under a
// parent that stayed behind. A delete takes the whole subtree, so it needs
// Full access on everything in it (node-placement checkFolderDelete).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { archiveFolder, updateFolder, type UpdateFolderInput } from "@/lib/folder";
import { moveToTrash } from "@/lib/trash";
import { prisma } from "@/lib/prisma";
import { nodeCtxFromLevel, nodeRole } from "@/lib/access/node-access";
import { PlacementConflict, checkFolderDelete, moveFolder } from "@/lib/access/node-placement";
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
    select: { id: true, spaceId: true, parentFolderId: true, organizationId: true, visibility: true },
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
  const { parentFolderId, position, spaceId, ...fields } = parsed.data;
  const rest: UpdateFolderInput = {
    name: fields.name, description: fields.description, icon: fields.icon, color: fields.color, visibility: fields.visibility,
  };
  for (const k of Object.keys(rest) as Array<keyof UpdateFolderInput>) if (rest[k] === undefined) delete rest[k];
  if (rest.name !== undefined && !rest.name.trim()) {
    return NextResponse.json({ error: "Folder name cannot be empty" }, { status: 400 });
  }
  // A new parent or a Space is a move (P2, P3, P4): the one move helper,
  // before anything else is written, so a refused move writes nothing at all.
  // With a Space and no parent named, the parent is the one the Folder has.
  const placing = parentFolderId !== undefined || spaceId !== undefined;
  let moved: Awaited<ReturnType<typeof moveFolder>> | null = null;
  if (placing) {
    moved = await moveFolder(gate.ctx, id, {
      spaceId,
      parentFolderId: parentFolderId !== undefined ? parentFolderId : gate.folder.parentFolderId,
      position,
    });
    if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: moved.status });
  }
  try {
    const before = gate.folder.visibility;
    const patch = { ...rest, ...(!placing && position !== undefined ? { position } : {}) };
    const updated = Object.keys(patch).length === 0 && moved?.ok
      ? await prisma.folder.findUnique({ where: { id } })
      : await prisma.$transaction(async (tx) => {
          const row = await updateFolder(id, patch, tx);
          if (patch.visibility !== undefined && patch.visibility !== before) {
            await recordGeneralAccessChange(tx, { userId: c.userId, organizationId: c.organizationId }, { kind: "folder", id }, { visibility: { from: before, to: patch.visibility } });
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
  // Both deletes take the whole subtree out of the tree: Full access on
  // everything in it, or on the Folder's Space.
  const allowed = await checkFolderDelete(gate.ctx, id);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const hard = new URL(req.url).searchParams.get("hard") === "1";
  if (hard) {
    // Recoverable delete: the Folder and its whole subtree as one Trash row.
    try {
      await moveToTrash("folder", id, { organizationId: c.organizationId, userId: c.userId, userName: c.userName });
    } catch (err) {
      // A branch that kept growing under its locks: nothing was written.
      if (err instanceof PlacementConflict) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
    return NextResponse.json({ ok: true });
  }
  const archived = await archiveFolder(id, c.userId);
  return NextResponse.json({ folder: archived });
}
