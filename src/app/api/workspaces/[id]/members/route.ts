// GET    /api/workspaces/[id]/members          — list members
// POST   /api/workspaces/[id]/members          — add (or update role) for one user
// DELETE /api/workspaces/[id]/members?userId=  — remove
//
// Only org admins / managers can mutate membership. Removing the last
// OWNER is blocked so a workspace can't be orphaned.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = (session.user as { id?: string }).id;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const organizationId = (session.user as { organizationId?: string }).organizationId;
  if (!userId || !organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId, accessLevel, organizationId };
}

async function resolveWorkspace(id: string, organizationId: string) {
  return prisma.workspace.findFirst({
    where: { id, organizationId },
    select: { id: true, isDefault: true },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const ws = await resolveWorkspace(id, c.organizationId);
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  // Active members of the workspace, plus the org's user list for the
  // "add member" picker (we filter out users already in the workspace
  // client-side to keep the API simple).
  const [members, addable] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: ws.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, role: true, createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true } },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: c.organizationId, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 500,
    }),
  ]);

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt,
      user: m.user,
    })),
    addableUsers: addable,
    isDefault: ws.isDefault,
  });
}

const postSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "EDITOR", "VIEWER"]).default("EDITOR"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required" }, { status: 403 });
  }
  const { id } = await params;
  const ws = await resolveWorkspace(id, c.organizationId);
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Confirm the user being added belongs to the same org — prevents
  // a forged userId from another tenant being attached.
  const user = await prisma.user.findFirst({
    where: { id: parsed.data.userId, organizationId: c.organizationId },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "User not in this org" }, { status: 400 });

  // Upsert: a second POST for the same user updates the role.
  const member = await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
    update: { role: parsed.data.role },
    create: { workspaceId: ws.id, userId: user.id, role: parsed.data.role },
  });
  return NextResponse.json({ member });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required" }, { status: 403 });
  }
  const { id } = await params;
  const ws = await resolveWorkspace(id, c.organizationId);
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // Block removing the last OWNER so the workspace doesn't get orphaned.
  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: ws.id, userId } },
    select: { role: true },
  });
  if (!target) return NextResponse.json({ error: "Not a member" }, { status: 404 });
  if (target.role === "OWNER") {
    const otherOwners = await prisma.workspaceMember.count({
      where: { workspaceId: ws.id, role: "OWNER", NOT: { userId } },
    });
    if (otherOwners === 0) {
      return NextResponse.json(
        { error: "Can't remove the last owner. Promote someone else first." },
        { status: 400 },
      );
    }
  }

  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId: ws.id, userId } },
  });
  return NextResponse.json({ ok: true });
}
