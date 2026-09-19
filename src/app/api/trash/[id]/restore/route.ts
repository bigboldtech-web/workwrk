// POST /api/trash/[id]/restore
//
// Body: { targetBoardId? } for the spec's "Restore to..." case, where a task's
// own List is gone and the person picks a new one. Without it such a row could
// be listed and never restored.
//
// Un-archives in place, or re-creates from the snapshot. Gated the same way
// the list is (spec-spaces-lists section 2 /trash): Owner and Admin over the
// org, everyone else over what they deleted or hold Full access on. It used to
// be `isManager`, which is why a Member could not undo their own delete
// (work-tasks #11).

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { restoreTrashRow } from "@/lib/trash-server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "trash" });
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { targetBoardId?: unknown };
    const targetBoardId = typeof body.targetBoardId === "string" && body.targetBoardId ? body.targetBoardId : null;
    const res = await restoreTrashRow(viewer, id, { targetBoardId });
    if (!res.ok) return jsonError(res.message, res.status);
    return jsonSuccess({ restored: true });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
