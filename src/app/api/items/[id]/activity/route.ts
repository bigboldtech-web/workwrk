// GET /api/items/[id]/activity: the task's activity log.
//
// `?kind=status|assignees|dates|fields|comments|attachments|lifecycle` filters
// it (src/lib/item-activity-kinds.ts owns the mapping and its completeness
// test). An unknown kind means "no filter", never a 400: an Activity tab that
// errors on a stale bookmark is worse than one that shows everything.
//
// Gated on the ITEM ref, like every other item route. Until Phase 2 this route
// resolved a Space first, so it 404'd for an assignee outside the Space and for
// every personal-list task (the personal board has no spaceId at all).

import { NextResponse } from "next/server";
import { listActivity } from "@/lib/item-thread";
import { parseActivityKind } from "@/lib/item-activity-kinds";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { activityListFieldIds, keepReadableListFields, redactActivityForLinkedReader } from "@/lib/list-metadata";
import { listReader } from "@/lib/list-links-server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;

  const kind = parseActivityKind(new URL(req.url).searchParams.get("kind"));
  const raw = await listActivity(id, { kind });
  // Phase 5b, for EVERY reader: a secondary List's field changes are named
  // only for the Lists this reader can read. A home reader who cannot see
  // List B is not told the task is shared into B, nor what B's columns are.
  const reader = listReader(c);
  const readableLists = new Set<string>();
  for (const listId of activityListFieldIds(raw)) if (await reader.row(listId)) readableLists.add(listId);
  const rows = keepReadableListFields(raw, readableLists);
  // And a reader who reached the task only through a List it is linked into
  // is not shown the home List's field names or its List ids either.
  const activity = gate.decision.via === "linked-list" && gate.viaLinkedList
    ? redactActivityForLinkedReader(rows, gate.viaLinkedList.id)
    : rows;
  return NextResponse.json({ activity, kind });
}
