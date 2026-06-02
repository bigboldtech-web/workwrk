// GET    /api/spaces/[id]/members        — list members
// POST   /api/spaces/[id]/members        — add/upsert member { userId, role }
// DELETE /api/spaces/[id]/members?userId — remove member

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import {
  addSpaceMember,
  canEditSpace,
  getSpaceForReader,
  listSpaceMembers,
  removeSpaceMember,
} from "@/lib/space";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const space = await getSpaceForReader(id, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const members = await listSpaceMembers(id);
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
  const space = await getSpaceForReader(id, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(id, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const member = await addSpaceMember(id, parsed.data.userId, parsed.data.role, c.userId);
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
  const space = await getSpaceForReader(id, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(id, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId query param required" }, { status: 400 });
  try {
    await removeSpaceMember(id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove member" },
      { status: 400 },
    );
  }
}
