// GET /api/items/[id]/activity — list activity rows for a Board Item
// (status / title / owner changes + comment hooks).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSpaceForReader } from "@/lib/space";
import { listActivity } from "@/lib/item-thread";
import { prisma } from "@/lib/prisma";

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
  const item = await prisma.item.findUnique({
    where: { id },
    include: { board: { select: { spaceId: true, organizationId: true } } },
  });
  if (!item || item.organizationId !== c.organizationId || !item.board.spaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const space = await getSpaceForReader(item.board.spaceId, c.userId, c.accessLevel);
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const activity = await listActivity(id);
  return NextResponse.json({ activity });
}
