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
import { freeTrashStorage } from "@/lib/trash";

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
    // Free the blobs before the rows that name them are gone, or the storage
    // is orphaned with no way left to find it.
    const files = await prisma.trashItem.findMany({
      where: { organizationId: orgId, entityType: "file" },
      select: { entityType: true, snapshot: true },
    });
    for (const f of files) await freeTrashStorage(f.entityType, f.snapshot);

    const res = await prisma.trashItem.deleteMany({ where: { organizationId: orgId } });
    return jsonSuccess({ deleted: res.count });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
