// POST /api/spaces/[id]/move — re-parent a Space in the Space tree. Body:
// { parentSpaceId: string | null } (null = top level). Requires edit access to
// the Space AND (when nesting) the target parent. Guards against a cycle:
// a Space can't move into itself or one of its own descendants.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSpace, spaceReparentRefusal } from "@/lib/space";

async function ctx() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const space = await prisma.space.findFirst({
    where: { id, organizationId: c.organizationId },
    select: { id: true },
  });
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canEditSpace(id, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "You don't have permission to move this Space." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parentSpaceId = typeof body?.parentSpaceId === "string" ? body.parentSpaceId : null;
  const refused = await spaceReparentRefusal(id, parentSpaceId, c);
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });

  try {
    await prisma.space.update({ where: { id }, data: { parentSpaceId } });
    return NextResponse.json({ space: { id, parentSpaceId } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't move the Space" },
      { status: 400 },
    );
  }
}
