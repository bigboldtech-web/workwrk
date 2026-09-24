// POST /api/tables/[id]/duplicate   -> 201 { id }
//
// "Make a copy" (the sheet's File menu) and "Duplicate" (the one table row
// menu, spec-tables-forms section 2 /tables). The copy is a new table in the
// same Space, named "Copy of {name}", made by the caller, with the source's
// columns, sort/filter/freeze slot (views), settings (named ranges) and every
// live row, values byte for byte and in the same order. Its public link is
// OFF: publishing is a separate, confirmed act by whoever holds Full access.
// Deleted rows (the table's own Trash) are not copied.
//
// Gate: anyone who can open the table may copy it (read implies write stays
// the rule for content until the access engine lands Can view). The copy's
// rows are written in chunks inside one transaction, so a failed copy leaves
// no half table behind.

import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { readableTable } from "@/lib/table-gate";
import { logActivity } from "@/lib/activity";
import { copyName } from "@/lib/tables-forms-list";

const CHUNK = 1000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const source = await readableTable(id, orgId, userId, session);
  if (!source) return jsonError("not found", 404);

  const rows = await prisma.dataTableRow.findMany({
    where: { tableId: id, deletedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { values: true, position: true },
  });

  const copy = await prisma.$transaction(async (tx) => {
    const t = await tx.dataTable.create({
      data: {
        organizationId: orgId,
        name: copyName(source.name, "Untitled table"),
        description: source.description,
        columns: source.columns as Prisma.InputJsonValue,
        views: source.views as Prisma.InputJsonValue,
        settings: (source.settings ?? {}) as Prisma.InputJsonValue,
        spaceId: source.spaceId,
        createdById: userId,
        isPublic: false,
      },
    });
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.dataTableRow.createMany({
        data: rows.slice(i, i + CHUNK).map((r) => ({
          organizationId: orgId,
          tableId: t.id,
          // A row whose stored body is JSON null (a shape import and the
          // blank-tail code both allow for) is copied as JSON null: Prisma
          // refuses a bare null for a Json column, and one such row would
          // otherwise fail the whole copy.
          values: r.values === null ? Prisma.JsonNull : (r.values as Prisma.InputJsonValue),
          position: r.position,
          createdById: userId,
        })),
      });
    }
    return t;
  }, { timeout: 60_000 });

  void logActivity({
    type: "table.create",
    actorId: userId,
    organizationId: orgId,
    description: `Made a copy of table "${source.name}"`,
    targetId: copy.id,
    targetType: "DataTable",
  });

  return jsonSuccess({ id: copy.id }, 201);
}
