// DELETE /api/spaces/[id]/invitations/[inviteId] — revoke a pending
// Space invitation. Hard-deletes the row (the token becomes unusable
// immediately; accept-invite GET will return 404).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditSpace, getSpaceForReader } from "@/lib/space";

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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id: spaceId, inviteId } = await params;

  const space = await getSpaceForReader(spaceId, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.invitation.findFirst({
    where: { id: inviteId, organizationId: c.organizationId, spaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }
  await prisma.invitation.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
