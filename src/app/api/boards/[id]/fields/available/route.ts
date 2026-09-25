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
import { isMirrorField } from "@/lib/list-connect";
import { listReader } from "@/lib/list-links-server";
import { redactFieldsForViewer } from "@/lib/board-items-view";

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
  //
  // Phase 5b: a MIRROR is never offered (it names another List's field keys
  // and its own List's connect field, so a copy would point at nothing), and
  // a connect field's targets pass through redactFieldForViewer, so the
  // "Add existing" tab can never name a List the caller cannot read.
  const reader = listReader({ userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId });
  const seen = new Set<string>();
  const candidates: Array<{ boardId: string; boardName: string; field: { key: string; label: string; type: string; options?: unknown } }> = [];
  for (const sib of siblings) {
    const visible = await redactFieldsForViewer(parseBoardSchema(sib.schema).fields.filter((f) => !isMirrorField(f)), reader);
    for (const f of visible) {
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
