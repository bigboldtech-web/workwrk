// PATCH  /api/conversations/[id]/updates/[updateId]   pause, resume, or change the schedule
// DELETE /api/conversations/[id]/updates/[updateId]   remove it (its posts stay)
//
// Who may manage an update: the person who set it up, a Full holder of the
// conversation, or an org Owner or Admin who can read the conversation. The
// kind and the List or Space never change: remove it and set up another.
// Resuming moves it to its next instant from now, never a missed one.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requireConversation } from "@/lib/talk-gate";
import { logActivity } from "@/lib/activity";
import { memberViewer } from "@/lib/list-links-server";
import { nextTalkUpdateAt, scheduleProblem, talkUpdatePatchSchema } from "@/lib/talk-updates";
import { describeUpdates, isMissingUpdatesTable, scheduleOf } from "@/lib/talk-updates-server";

type Params = { params: Promise<{ id: string; updateId: string }> };

async function load(req: { id: string; updateId: string }) {
  const { error, ctx } = await requireConversation(req.id, { floor: "view" });
  if (error) return { error } as const;
  const row = await prisma.talkUpdate.findFirst({ where: { id: req.updateId, conversationId: req.id, organizationId: ctx.gate.organizationId } });
  if (!row) return { error: jsonError("That update no longer exists.", 404) } as const;
  const manageAll = ctx.role === "full" || ctx.gate.orgRole === "OWNER" || ctx.gate.orgRole === "ADMIN";
  if (row.createdById !== ctx.viewer.userId && !manageAll) {
    return { error: jsonError("Only the person who set this up, or someone with Full access here, can change it.", 403) } as const;
  }
  return { ctx, row, manageAll } as const;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const p = await params;
  try {
    const got = await load({ id: p.id, updateId: p.updateId });
    if ("error" in got) return got.error;
    const { ctx, row, manageAll } = got;
    const parsed = talkUpdatePatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError("Check the update's settings.", 400);
    const d = parsed.data;
    const cadence = d.cadence ?? (row.cadence as "weekdays" | "weekly");
    const schedule = {
      cadence,
      weekday: cadence === "weekly" ? (d.weekday !== undefined ? d.weekday : row.weekday) : null,
      timeOfDay: d.timeOfDay ?? row.timeOfDay,
      timezone: d.timezone ?? row.timezone,
    };
    const bad = scheduleProblem(schedule);
    if (bad) return jsonError(bad === "needs_weekday" ? "Pick the day of the week." : bad === "invalid_timezone" ? "Pick a time zone." : "Pick a time of day.", 400);
    const status = d.status ?? (row.status as "active" | "paused");
    const now = new Date();
    const scheduleChanged = JSON.stringify(schedule) !== JSON.stringify(scheduleOf(row));
    const resumed = status === "active" && row.status !== "active";
    const updated = await prisma.talkUpdate.update({
      where: { id: row.id },
      data: {
        ...schedule,
        status,
        ...(status === "paused" ? { nextRunAt: null, ...(row.status !== "paused" ? { pausedReason: null } : {}) } : {}),
        ...(status === "active" && (resumed || scheduleChanged || !row.nextRunAt) ? { nextRunAt: nextTalkUpdateAt(schedule, now), pausedReason: null } : {}),
      },
    });
    await logActivity({
      type: status !== row.status ? (status === "paused" ? "talk.update_paused" : "talk.update_resumed") : "talk.update_changed",
      actorId: ctx.viewer.userId,
      organizationId: ctx.gate.organizationId,
      description: status !== row.status ? (status === "paused" ? "Paused a scheduled AI update" : "Resumed a scheduled AI update") : "Changed a scheduled AI update's schedule",
      targetId: p.id,
      targetType: "conversation",
      metadata: { updateId: row.id },
    });
    const me = await memberViewer(ctx.viewer.userId, ctx.gate.organizationId);
    const [update] = await describeUpdates([updated], { userId: ctx.viewer.userId, organizationId: ctx.gate.organizationId, manageAll, linkViewer: me });
    return jsonSuccess({ update });
  } catch (err) {
    if (isMissingUpdatesTable(err)) return jsonError("Scheduled updates aren't ready on this server yet.", 503);
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const p = await params;
  try {
    const got = await load({ id: p.id, updateId: p.updateId });
    if ("error" in got) return got.error;
    const { ctx, row } = got;
    // Its runs go with it (cascade); the messages it posted stay in the conversation.
    await prisma.talkUpdate.delete({ where: { id: row.id } });
    await logActivity({
      type: "talk.update_deleted",
      actorId: ctx.viewer.userId,
      organizationId: ctx.gate.organizationId,
      description: "Removed a scheduled AI update",
      targetId: p.id,
      targetType: "conversation",
      metadata: { updateId: row.id, kind: row.kind },
    });
    return jsonSuccess({ ok: true });
  } catch (err) {
    if (isMissingUpdatesTable(err)) return jsonError("Scheduled updates aren't ready on this server yet.", 503);
    throw err;
  }
}
