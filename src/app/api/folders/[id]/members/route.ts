// GET    /api/folders/[id]/members        — list who a folder is shared with
// POST   /api/folders/[id]/members        — add/upsert member { userId, role }
// DELETE /api/folders/[id]/members?userId  — revoke a member
//
// A FolderMember row is the Folder's own grant: it reaches this Folder and
// everything inside it (sub-folders, Lists and their tasks, docs, canvases)
// and nothing above it or beside it. Reading the list needs Can view on the
// Folder; changing it needs Full access on the Folder.
//
// The URLs and shapes are kept for their callers (GET { members }, POST 201
// { member }, DELETE { ok: true }). Every write goes through the one grant
// writer, src/lib/access/grants.ts, so it is transactional, recorded as
// access activity, notifies the person, refuses someone outside the org and
// holds every role to the actor's own (a Full holder of this node gives at
// most Full access here, and nothing on the node's Space or Folder: roles
// never climb). The role is written through unchanged, so an OWNER row
// still works.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { listFolderMembers } from "@/lib/folder";
import { nodeCtxFromLevel, nodeRole } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { GrantError, removeNodeGrant, setNodeGrant } from "@/lib/access/grants";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { node: nodeCtxFromLevel(u.id, u.organizationId, u.accessLevel) };
}

function grantFailure(err: unknown): NextResponse {
  if (err instanceof GrantError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to change members" }, { status: 400 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  // Can view on the Folder itself: a path container is not a role, and its
  // member list is exactly what a path must never show.
  const d = await nodeRole(c.node, { kind: "folder", id });
  if (!roleAtLeast(d.role, "VIEW")) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    await setNodeGrant(c.node, { kind: "folder", id }, { userId: parsed.data.userId, memberRole: parsed.data.role }, "members-route");
    const member = await prisma.folderMember.findUnique({ where: { folderId_userId: { folderId: id, userId: parsed.data.userId } } });
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return grantFailure(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId query param required" }, { status: 400 });
  try {
    await removeNodeGrant(c.node, { kind: "folder", id }, { userId }, "members-route");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return grantFailure(err);
  }
}
