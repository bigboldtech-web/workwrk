// POST /api/trash/bulk { op: "restore" | "purge", ids: string[] }
//
// The bulk bar's two actions (spec-spaces-lists section 2 /trash). Each id goes
// through the same gate a single action does, so a bulk call can never do what
// a per-row call would refuse; the response says how many of each landed rather
// than failing the whole batch on one bad id.

import { NextRequest } from "next/server";
import { z } from "zod";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { purgeTrashRow, restoreTrashRow } from "@/lib/trash-server";

const schema = z.object({
  op: z.enum(["restore", "purge"]),
  ids: z.array(z.string().min(1)).min(1).max(200),
  /** "Restore to...": the List a task whose own List is gone should land in. */
  targetBoardId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "trash" });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid body", 400);
    const { op, ids, targetBoardId } = parsed.data;

    if (op === "purge" && viewer.orgRole !== "OWNER" && viewer.orgRole !== "ADMIN") {
      return jsonError("Only an Admin or the Owner can delete permanently.", 403);
    }

    let done = 0;
    const failed: Array<{ id: string; message: string }> = [];
    for (const id of ids) {
      const res = op === "restore"
        ? await restoreTrashRow(viewer, id, { targetBoardId: targetBoardId ?? null })
        : await purgeTrashRow(viewer, id);
      if (res.ok) done += 1;
      else failed.push({ id, message: res.message });
    }
    return jsonSuccess({ done, failed });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
