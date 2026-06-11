// GET /api/boards/[id]/fields/available — fields defined on sibling
// boards in the same Space, for the FieldShelf "Add existing" tab.
// Picking one copies the definition (label/type/options) onto this
// board via the existing POST /api/boards/[id]/fields.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSpaceForReader } from "@/lib/space";
import { parseBoardSchema } from "@/lib/field-catalog";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const board = await prisma.board.findUnique({
    where: { id },
    select: { spaceId: true, organizationId: true },
  });
  if (!board || board.organizationId !== u.organizationId || !board.spaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const space = await getSpaceForReader(board.spaceId, u.id, u.accessLevel ?? "EMPLOYEE");
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const siblings = await prisma.board.findMany({
    where: { spaceId: board.spaceId, id: { not: id }, organizationId: u.organizationId },
    select: { id: true, name: true, schema: true },
    orderBy: { name: "asc" },
  });

  // Dedupe by (type, label) — the same field defined on two sibling
  // boards shows once, attributed to the first board found.
  const seen = new Set<string>();
  const candidates: Array<{ boardId: string; boardName: string; field: { key: string; label: string; type: string; options?: unknown } }> = [];
  for (const sib of siblings) {
    for (const f of parseBoardSchema(sib.schema).fields) {
      const dedupeKey = `${f.type}:${f.label.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({
        boardId: sib.id,
        boardName: sib.name,
        field: { key: f.key, label: f.label, type: f.type, options: f.options },
      });
    }
  }

  return NextResponse.json({ candidates });
}
