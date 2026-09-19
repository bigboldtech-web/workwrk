// POST /api/items/bulk — one patch, many tasks.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/my-work, Data):
// "`POST /api/items/bulk` (new: `{ ids[], patch }`) for the bulk bar".
//
// WHY IT IS A ROUTE AND NOT A LOOP IN THE CLIENT. It already was a loop in the
// client: `board-table-view.tsx` fired one `PATCH /api/items/[id]` per selected
// row, so selecting forty tasks and setting a due date was forty requests,
// forty gates, forty activity rows and forty chances to half-apply. Worse, it
// had no way to report which ones failed, so a selection that spanned a List
// the viewer can only read looked like it worked.
//
// EVERY ROW IS GATED INDIVIDUALLY. There is no "bulk permission": a selection
// can span Lists, and the answer for each task is the answer `gateItem` gives
// for that task. The response says exactly what happened to each id, and the
// client's toast says "38 updated · 2 you can't edit" rather than nothing.
//
// PARTIAL SUCCESS IS THE CONTRACT, not a failure mode. The alternative is one
// transaction that rolls the whole selection back because one row was
// read-only, which loses work the viewer was allowed to do. So each row is
// applied on its own and the report is complete.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx, gateItem } from "@/lib/item-gate";
import { archiveBoardItem, updateBoardItem } from "@/lib/board-items";
import { notifyItemAssigned, notifyItemStatusChanged } from "@/lib/notify-item";
import { unknownUserIds } from "@/lib/assignable";

export const dynamic = "force-dynamic";

/** A selection bigger than this is a filter, not a selection. */
const MAX_IDS = 200;

const patchSchema = z.object({
  status: z.string().max(60).nullable().optional(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  // Shape-checked here, existence-checked against the org below. Bare
  // `z.string()` let a whitespace-only id and a 5000-character string through
  // into columns that carry no foreign key. See PATCH /api/items/[id].
  ownerId: z.string().trim().min(1).max(64).nullable().optional(),
  assigneeIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  /** The one destructive action the bar offers; it is a soft archive. */
  archive: z.literal(true).optional(),
}).refine(
  (v) => Object.keys(v).length > 0,
  { message: "Nothing to change" },
);

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_IDS),
  patch: patchSchema,
});

type RowOutcome = { id: string; ok: true } | { id: string; ok: false; reason: "not_found" | "no_access" | "failed" };

export async function POST(req: NextRequest) {
  const c = await itemCtx();
  if ("error" in c) return c.error;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }

  const ids = Array.from(new Set(parsed.data.ids));
  const patch = parsed.data.patch;

  // Every assignee id is a real, live person in THIS organization. One check
  // for the whole batch, before a single row is written: a junk id merged into
  // two hundred tasks is two hundred phantom assignees no picker can remove.
  const proposedUserIds = [
    ...(patch.assigneeIds ?? []),
    ...(typeof patch.ownerId === "string" ? [patch.ownerId] : []),
  ];
  if (proposedUserIds.length > 0) {
    const unknown = await unknownUserIds(proposedUserIds, c.organizationId);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "no_access", reason: "unknown_assignee", requestAccess: false },
        { status: 400 },
      );
    }
  }

  const results: RowOutcome[] = [];

  // Sequential, not parallel. Two hundred concurrent gates each firing three
  // access queries is a self-inflicted load spike, and a bulk edit is not a
  // latency-sensitive path: the bar shows a saving dot while it runs.
  for (const id of ids) {
    const gate = await gateItem(id, c, patch.archive ? "delete" : "edit");
    if ("error" in gate) {
      results.push({ id, ok: false, reason: gate.error.status === 404 ? "not_found" : "no_access" });
      continue;
    }
    try {
      if (patch.archive) {
        await archiveBoardItem(id, c.userId);
        results.push({ id, ok: true });
        continue;
      }

      const before = gate.item;
      const updated = await updateBoardItem(
        id,
        {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt ? new Date(patch.dueAt) : null } : {}),
          ...(patch.startAt !== undefined ? { startAt: patch.startAt ? new Date(patch.startAt) : null } : {}),
          ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
          ...(patch.assigneeIds !== undefined ? { assigneeIds: patch.assigneeIds } : {}),
        },
        c.userId,
      );

      // The same two notifications a single PATCH sends, on the same terms: a
      // real transition only, and never to the person who made it. A bulk edit
      // is not a reason for the people it touches to hear about it less.
      const target = { id, title: updated.title, dueAt: updated.dueAt ?? null };
      if (patch.ownerId !== undefined && patch.ownerId && patch.ownerId !== before.ownerId) {
        await notifyItemAssigned({
          organizationId: c.organizationId,
          item: target,
          ownerId: patch.ownerId,
          actorId: c.userId,
          reassigned: before.ownerId !== null,
        }).catch(() => {});
      }
      if (patch.status !== undefined && patch.status !== before.status) {
        await notifyItemStatusChanged({
          organizationId: c.organizationId,
          item: target,
          board: before.board,
          previousStatus: before.status,
          status: updated.status,
          ownerId: updated.ownerId,
          actorId: c.userId,
          metadata: before.metadata,
        }).catch(() => {});
      }
      results.push({ id, ok: true });
    } catch {
      results.push({ id, ok: false, reason: "failed" });
    }
  }

  const updated = results.filter((r) => r.ok).length;
  return NextResponse.json({
    updated,
    skipped: results.length - updated,
    results,
  });
}
