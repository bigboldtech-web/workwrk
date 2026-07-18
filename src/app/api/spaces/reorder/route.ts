// POST /api/spaces/reorder — batch-update Space.displayOrder for a manual
// sidebar drag-reorder. Body: { items: [{ id, displayOrder }] }. Every Space
// must be in the caller's org and editable (SpaceMember OWNER/ADMIN or org
// admin) — displayOrder is a shared column, so reordering is an edit for all.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSpace } from "@/lib/space";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const accessLevel = u.accessLevel ?? "EMPLOYEE";

  const body = await req.json().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Provide a non-empty items array" }, { status: 400 });
  }
  if (items.length > 500) {
    return NextResponse.json({ error: "Too many items in one reorder" }, { status: 400 });
  }
  for (const it of items) {
    if (typeof it?.id !== "string" || typeof it?.displayOrder !== "number" || !Number.isInteger(it.displayOrder)) {
      return NextResponse.json({ error: "Each item must be { id: string, displayOrder: int }" }, { status: 400 });
    }
  }

  const ids: string[] = items.map((i: { id: string }) => i.id);
  // All must belong to the caller's org.
  const owned = await prisma.space.findMany({
    where: { id: { in: ids }, organizationId: u.organizationId },
    select: { id: true },
  });
  if (owned.length !== new Set(ids).size) {
    return NextResponse.json({ error: "One or more Spaces are not in your organization" }, { status: 403 });
  }
  // And all must be editable by the caller.
  const editable = await Promise.all(ids.map((id) => canEditSpace(id, u.id!, accessLevel)));
  if (editable.some((ok) => !ok)) {
    return NextResponse.json({ error: "You can't reorder one or more of these Spaces" }, { status: 403 });
  }

  await prisma.$transaction(
    items.map((it: { id: string; displayOrder: number }) =>
      prisma.space.update({ where: { id: it.id }, data: { displayOrder: it.displayOrder } }),
    ),
  );

  return NextResponse.json({ reordered: items.length });
}
