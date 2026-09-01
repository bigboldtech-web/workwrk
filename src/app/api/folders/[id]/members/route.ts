// GET    /api/folders/[id]/members        — list who a folder is shared with
// POST   /api/folders/[id]/members        — add/upsert member { userId, role }
// DELETE /api/folders/[id]/members?userId  — revoke a member
//
// Granular access: a FolderMember row lets a NON-space-member reach exactly
// this folder (and its subtree). Reading the list needs folder read access;
// changing it needs folder EDIT (folder owner/admin, the parent Space's
// admins, or an org admin) — resolved centrally by lib/access.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEdit, canRead, type ViewerContext } from "@/lib/access";
import { addFolderMember, listFolderMembers, removeFolderMember } from "@/lib/folder";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const viewer: ViewerContext = {
    userId: u.id,
    organizationId: u.organizationId,
    accessLevel: u.accessLevel ?? "EMPLOYEE",
  };
  return { viewer };
}

/** Confirm the folder exists in the viewer's org before any access check —
 *  keeps a cross-org id indistinguishable from a missing one (404, not 403). */
async function folderInOrg(folderId: string, organizationId: string): Promise<boolean> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { organizationId: true },
  });
  return !!folder && folder.organizationId === organizationId;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  if (!(await folderInOrg(id, c.viewer.organizationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canRead(c.viewer, { type: "folder", id }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const members = await listFolderMembers(id);
  return NextResponse.json({ members });
}

const addSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]).default("MEMBER"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  if (!(await folderInOrg(id, c.viewer.organizationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEdit(c.viewer, { type: "folder", id }))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // The grantee must belong to the same org — never share a folder outward.
  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== c.viewer.organizationId) {
    return NextResponse.json({ error: "User not in your organization" }, { status: 400 });
  }
  try {
    const member = await addFolderMember(id, parsed.data.userId, parsed.data.role, c.viewer.userId);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add member" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  if (!(await folderInOrg(id, c.viewer.organizationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEdit(c.viewer, { type: "folder", id }))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId query param required" }, { status: 400 });
  try {
    await removeFolderMember(id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove member" },
      { status: 400 },
    );
  }
}
