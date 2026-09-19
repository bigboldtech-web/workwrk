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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;

  const kind = parseActivityKind(new URL(req.url).searchParams.get("kind"));
  const activity = await listActivity(id, { kind });
  return NextResponse.json({ activity, kind });
}
