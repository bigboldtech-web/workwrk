// GET  /api/items/[id]/updates: comments on a task, with their attachments
//                                 and reactions. `?around=<updateId>` returns
//                                 the page containing that comment.
// POST /api/items/[id]/updates: add a comment { body, mentionedUserIds?,
//                                 attachmentIds? }
//
// THE FIX THIS FILE CARRIES (spec-task-detail section 4 step 2). Until Phase 2
// both verbs resolved a SPACE before they would answer:
//
//     if (!item || !item.board.spaceId) return 404
//     if (!getSpaceForReader(item.board.spaceId, ...)) return 404
//
// which broke two whole populations, silently, because the client swallowed
// the non-ok response and rendered "No comments yet":
//
//   * an ASSIGNEE in a Space they are not a member of, who could open the task
//     and could not see or post a single comment on it; and
//   * EVERY PERSONAL-LIST TASK, because the personal board is space-less by
//     construction, so 100% of personal tasks had no thread at all.
//
// Gating on the ITEM ref fixes both at once. There is nothing to migrate and
// no new column. src/lib/item-gate.test-notes and the regression test in
// src/lib/item-gate.personal.test.ts pin the personal-list case, because this
// is exactly the kind of thing a future Space-scoped helper would break again.

import { NextResponse } from "next/server";
import { listUpdates, listUpdatesAround } from "@/lib/item-thread";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { postItemCommentAs } from "@/lib/items/item-comment";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;

  // What this viewer may DO in the thread, answered by the thread's own
  // endpoint. The composer and the per-comment trash icon used to be derived
  // from the host page's `canEdit`, so a Member saw a trash icon on everyone
  // else's comment and got a 403 every time (deleting another person's comment
  // is moderation: access section 1 gives it to Full access only, and Can edit
  // explicitly does not include it). Sending it here means every host, the
  // drawer, the page, the Inbox panel, is right without plumbing a new prop
  // through each one.
  const role = gate.decision.role;
  const can = {
    comment: role === "COMMENT" || role === "EDIT" || role === "FULL",
    /** Delete or hide SOMEONE ELSE'S comment. Your own is always yours. */
    moderate: role === "FULL",
  };

  const around = new URL(req.url).searchParams.get("around");
  if (around) {
    // A deep link to a comment that was deleted, or that belongs to another
    // task, answers 200 with `missing: true` and an empty list. A 404 here
    // would kill the whole task page over one dead anchor.
    const page = await listUpdatesAround(id, around);
    return NextResponse.json({ ...page, can });
  }
  const updates = await listUpdates(id);
  return NextResponse.json({ updates, can });
}

// The write path lives in src/lib/items/item-comment.ts, so an AI teammate's
// tools run it as the person they act for (docs/plans/ai-teammates.md 3.15).
// The session and the body are read here; whether this person may comment on
// this task is decided there.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  return postItemCommentAs(c, id, await req.json().catch(() => null));
}
