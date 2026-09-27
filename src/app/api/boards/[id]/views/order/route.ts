// PATCH /api/boards/[id]/views/order — one request for the whole view order.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (`/boards/[slug]`
// Data): "`PATCH /api/boards/[id]/views/order { ids[] }` (new, one request)".
//
// WHAT IT REPLACES. `board-view-tabs.tsx` persisted a drag by firing one PATCH
// per view in a `Promise.all` and then calling `router.refresh()`. Six views
// meant six requests, six gates and six chances for a half-applied order that
// nothing would ever reconcile; the refresh then re-read whatever survived. One
// transaction writes the whole order or none of it.
//
// IDS THE BOARD DOES NOT OWN ARE IGNORED, not rejected: a stale tab that drags
// a view another person has since deleted should reorder the rest, not fail.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { getSpaceForReader } from "@/lib/space";
import { canContributeBoard } from "@/lib/board";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const { id } = await params;

  const board = await prisma.board.findFirst({
    where: { id, organizationId: u.organizationId },
    select: { id: true, spaceId: true, ownerId: true },
  });
  if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A SPACE-LESS BOARD IS SOMEBODY'S OWN LIST. The Personal List (/my-work/
  // personal) has no Space, so `!board.spaceId -> 404` made every view drag on
  // that page fail silently: the tabs snapped back and nothing said why.
  if (!board.spaceId) {
    if (board.ownerId !== u.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } else {
    if (!(await getSpaceForReader(board.spaceId, u.id, accessLevel))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // THE CONTRIBUTE LADDER, the one that renders the tabs draggable
    // (boards/[slug]/page.tsx passes canManage={canContribute}) and the one
    // PATCH { displayOrder } on the sibling route already accepts. This gate
    // was canEditSpace, the Space MANAGEMENT ladder, so every drag a Space
    // member made answered 403 and snapped back.
    if (!(await canContributeBoard(id, u.id, accessLevel))) {
      return NextResponse.json(
        { error: "You can read this List but not reorder its views. Ask a List or Space admin for Can edit access." },
        { status: 403 },
      );
    }
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const own = await prisma.view.findMany({ where: { boardId: id }, select: { id: true } });
  const ownIds = new Set(own.map((v) => v.id));
  const ordered = Array.from(new Set(parsed.data.ids)).filter((viewId) => ownIds.has(viewId));
  if (ordered.length === 0) {
    return NextResponse.json({ error: "No views on this List matched" }, { status: 400 });
  }

  await prisma.$transaction(
    ordered.map((viewId, index) =>
      prisma.view.update({ where: { id: viewId }, data: { displayOrder: index } }),
    ),
  );

  const views = await prisma.view.findMany({
    where: { boardId: id, OR: [{ isShared: true }, { ownerId: null }, { ownerId: u.id }] },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ views });
}
