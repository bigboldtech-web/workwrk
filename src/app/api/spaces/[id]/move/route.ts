// POST /api/spaces/[id]/move: re-parent a Space in the Space tree. Body:
// { parentSpaceId: string | null } (null = top level).
//
// The placement rule for Space nesting (node-rules spaceNestVerdict, through
// lib/space spaceReparentRefusal): Full access on the Space itself (its OWNER
// or ADMIN, or an org admin) and Full access on the parent it goes under; the
// parent it leaves is asked nothing, since a Space's place under a parent
// carries no access. A Space the viewer cannot open is the same 404 as one
// that is not there, so a guessed id confirms nothing. Guards against a
// cycle: a Space can't move into itself or one of its own descendants.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSpace, getSpaceForReader, spaceReparentRefusal } from "@/lib/space";

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

  const space = await getSpaceForReader(id, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canEditSpace(id, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "You need Full access to this Space to move it." }, { status: 403 });
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
