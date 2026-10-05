// POST /api/trash/empty { confirm: "DELETE" }
//
// Owner and Admin only, behind a typed confirm (spec-spaces-lists section 2
// /trash). It empties the DELETED tab only: an archive is not waste, it is
// something somebody put away, and no single control should be able to destroy
// every archived Space in the workspace.

import { NextRequest } from "next/server";
import { z } from "zod";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { BLOB_TRASH_TYPES, freeTrashStorageMany } from "@/lib/trash";

const schema = z.object({ confirm: z.literal("DELETE") });

export async function POST(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "trash" });
    if (viewer.orgRole !== "OWNER" && viewer.orgRole !== "ADMIN") {
      return jsonError("Only an Admin or the Owner can empty the trash.", 403);
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError("Type DELETE to confirm.", 400);

    const orgId = viewer.organizationId;
    // The rows go first, in one statement that returns them, and only the
    // files of what it returned are freed (as the nightly purge does): a
    // restore that commits first keeps its files, and a row trashed while
    // this runs is not taken.
    const gone = await prisma.$queryRaw<Array<{ id: string; entityType: string; snapshot: unknown }>>`
      DELETE FROM "TrashItem"
      WHERE "organizationId" = ${orgId}
      RETURNING "id", "entityType",
        CASE WHEN "entityType" = ANY(${[...BLOB_TRASH_TYPES]}::text[]) THEN "snapshot" ELSE NULL END AS "snapshot"`;
    await freeTrashStorageMany(gone.filter((r) => r.snapshot !== null), orgId);
    return jsonSuccess({ deleted: gone.length });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
