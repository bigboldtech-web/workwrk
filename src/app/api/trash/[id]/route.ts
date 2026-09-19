// DELETE /api/trash/[id]: delete permanently.
//
// Owner and Admin only (spec-spaces-lists section 2 /trash): "Delete
// permanently" is the only red action on the page and it lives inside the "…"
// menu, never as a row button, so a Member restoring their own work can never
// hit the one thing that cannot be undone.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { purgeTrashRow } from "@/lib/trash-server";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "trash" });
    if (viewer.orgRole !== "OWNER" && viewer.orgRole !== "ADMIN") {
      return jsonError("Only an Admin or the Owner can delete permanently.", 403);
    }
    const { id } = await params;
    const res = await purgeTrashRow(viewer, id);
    if (!res.ok) return jsonError(res.message, res.status);
    return jsonSuccess({ deleted: true });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
