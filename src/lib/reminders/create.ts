// POST /api/reminders, as a function of WHO is acting
// (docs/plans/mcp-server.md step 3, section 11 item 1).
//
// A reminder is the person's own: it is made for the caller and nobody
// else. The route's body lives here, moved, and both callers come through
// it:
//
//   POST /api/reminders     reads the session (itemCtx) and the JSON body,
//                           then hands both here
//   create_reminder (src/lib/mcp/tools/write.ts)
//                           builds the person's context and hands it here
//
// THE TASK GATE (new with the MCP server). A reminder linked to a task
// ("BOARD_ITEM" and the task's id) deep-links to that task from the bell
// and the fired-reminder popup, and carries its id in the row. The route
// used to take any id on trust; now the link is checked through the one
// item gate (gateItem, "view"), so a task the caller cannot open answers
// exactly as every item route answers it (the gate's own 404), and nothing
// is made. Every reminder the app itself makes (the task's Schedule tab, the
// task menu) links a task its maker has open, so they are unchanged.
//
// The answer is the route's own NextResponse.
//
// Server-only: imports prisma.

import { NextResponse } from "next/server";
import { z } from "zod";
import { gateItem, type ItemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  remindAt: z.string(),
  notifyEmail: z.boolean().optional(),
  // Optional entity link: task reminders pass entityType "BOARD_ITEM" + the
  // item id so the bell can deep-link and recurrence can re-arm them.
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
});

/** The entity type a reminder linked to a task carries. */
export const REMINDER_TASK_ENTITY = "BOARD_ITEM";

/**
 * Make one reminder for `c`, exactly as POST /api/reminders does. `body` is
 * the request's JSON ({} when it did not parse); the answer is the route's
 * response, status and body included.
 */
export async function createReminderFor(c: ItemCtx, body: unknown): Promise<NextResponse> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const remindAt = new Date(parsed.data.remindAt);
  if (isNaN(remindAt.getTime())) return NextResponse.json({ error: "invalid remindAt" }, { status: 400 });
  // The task gate (see the file header): only a task the caller can open.
  if (parsed.data.entityType === REMINDER_TASK_ENTITY && parsed.data.entityId) {
    const gate = await gateItem(parsed.data.entityId, c, "view");
    if ("error" in gate) return gate.error;
  }
  const reminder = await prisma.reminder.create({
    data: {
      organizationId: c.organizationId, userId: c.userId,
      title: parsed.data.title, body: parsed.data.body ?? null,
      remindAt, notifyEmail: parsed.data.notifyEmail ?? false,
      entityType: parsed.data.entityType ?? null,
      entityId: parsed.data.entityId ?? null,
    },
  });
  return NextResponse.json({ reminder }, { status: 201 });
}
