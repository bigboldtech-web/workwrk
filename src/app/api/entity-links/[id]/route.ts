// DELETE /api/entity-links/[id] — remove a single link.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canMutateLinkFromSource } from "@/lib/entity-link-authz";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" };
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const existing = await prisma.entityLink.findFirst({
    where: { id, organizationId: c.organizationId },
    select: { id: true, sourceType: true, sourceId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Same governance-source edit gate the create path enforces.
  const session = { user: { id: c.userId, organizationId: c.organizationId, accessLevel: c.accessLevel } };
  const allowed = await canMutateLinkFromSource(session, c.organizationId, {
    type: existing.sourceType,
    id: existing.sourceId,
  });
  if (!allowed) return NextResponse.json({ error: "You can't edit links on this item." }, { status: 403 });

  await prisma.entityLink.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
