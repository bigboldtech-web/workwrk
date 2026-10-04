// GET  /api/conversations/[id]/updates   the conversation's scheduled AI updates
// POST /api/conversations/[id]/updates   set one up
//
// Batch 8, scheduled AI updates in Talk (src/lib/talk-updates.ts). Every
// member who can read the conversation sees which updates post into it and
// who set them up: an AI writing into a conversation is never hidden from
// the people reading it. Setting one up needs, in order: the `ai` app (a
// Guest 404s, AI off or the app hidden 403s), a conversation this person may
// post in, the workspace's opt-in, not an Agent account, a private channel
// or a group chat with no Guest and at most MAX_UPDATE_READERS people, at
// most MAX_UPDATES_PER_CONVERSATION updates, and a List or Space they can
// open.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requireApp } from "@/lib/app-gate";
import { requireConversation } from "@/lib/talk-gate";
import { canPost } from "@/lib/talk-access";
import { logActivity } from "@/lib/activity";
import { aiTalkUpdatesOn } from "@/lib/ai/ai-features";
import { memberViewer } from "@/lib/list-links-server";
import {
  MAX_UPDATES_PER_CONVERSATION,
  REASON_TEXT,
  nextTalkUpdateAt,
  scheduleProblem,
  talkUpdateInputSchema,
} from "@/lib/talk-updates";
import {
  conversationProblem,
  conversationReaders,
  describeUpdates,
  isMissingUpdatesTable,
  scopeFor,
  talkUpdatesCronInstalled,
} from "@/lib/talk-updates-server";

function notReady() {
  return jsonError("Scheduled updates aren't ready on this server yet.", 503);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error, ctx } = await requireConversation(id, { floor: "view" });
  if (error) return error;
  const orgId = ctx.gate.organizationId;
  try {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const on = aiTalkUpdatesOn(org?.settings);
    const rows = await prisma.talkUpdate.findMany({ where: { conversationId: id, organizationId: orgId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const me = await memberViewer(ctx.viewer.userId, orgId);
    const manageAll = ctx.role === "full" || ctx.gate.orgRole === "OWNER" || ctx.gate.orgRole === "ADMIN";
    const updates = await describeUpdates(rows, { userId: ctx.viewer.userId, organizationId: orgId, manageAll, linkViewer: me });
    // Whether this person could set one up here, and if not, the one reason
    // the panel says (never a button that is refused).
    let blocked: string | null = null;
    if (!on) blocked = REASON_TEXT.off;
    else if (!canPost(ctx.conversation, ctx.role) || !me) blocked = REASON_TEXT.cannot_post;
    else {
      const problem = conversationProblem(ctx.conversation);
      if (problem) blocked = REASON_TEXT[problem];
      else if (rows.length >= MAX_UPDATES_PER_CONVERSATION) blocked = `A conversation holds at most ${MAX_UPDATES_PER_CONVERSATION} scheduled updates.`;
      else {
        const readers = await conversationReaders(id, orgId);
        if (!readers.ok) blocked = REASON_TEXT[readers.reason];
      }
    }
    return jsonSuccess({ on, cronOn: talkUpdatesCronInstalled(), canCreate: blocked === null, blocked, updates });
  } catch (err) {
    if (isMissingUpdatesTable(err)) return notReady();
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const app = await requireApp("ai");
  if ("error" in app) return app.error;
  const { id } = await params;
  const { error, ctx } = await requireConversation(id, { floor: "edit", allow: canPost, what: "post here" });
  if (error) return error;
  const orgId = ctx.gate.organizationId;
  const userId = ctx.viewer.userId;
  if (app.viewer.isAgent) return jsonError("An agent account can't set up scheduled updates.", 403);

  const parsed = talkUpdateInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the update's settings.", 400);
  const input = parsed.data;
  const schedule = { cadence: input.cadence, weekday: input.cadence === "weekly" ? input.weekday ?? null : null, timeOfDay: input.timeOfDay, timezone: input.timezone };
  const bad = scheduleProblem(schedule);
  if (bad) return jsonError(bad === "needs_weekday" ? "Pick the day of the week." : bad === "invalid_timezone" ? "Pick a time zone." : "Pick a time of day.", 400);

  try {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    if (!aiTalkUpdatesOn(org?.settings)) return jsonError(REASON_TEXT.off, 403);
    const problem = conversationProblem(ctx.conversation);
    if (problem) return jsonError(REASON_TEXT[problem], 400);
    const count = await prisma.talkUpdate.count({ where: { conversationId: id } });
    if (count >= MAX_UPDATES_PER_CONVERSATION) return jsonError(`A conversation holds at most ${MAX_UPDATES_PER_CONVERSATION} scheduled updates.`, 409);
    const readers = await conversationReaders(id, orgId);
    if (!readers.ok) return jsonError(REASON_TEXT[readers.reason], 400);
    const me = await memberViewer(userId, orgId);
    if (!me) return jsonError(REASON_TEXT.cannot_post, 403);
    const scope = await scopeFor(input.scopeKind, input.scopeId, me);
    // One answer for a List that does not exist and one this person cannot open.
    if (!scope.ok) return jsonError(input.scopeKind === "list" ? "That List isn't available." : "That Space isn't available.", 404);

    const now = new Date();
    const row = await prisma.talkUpdate.create({
      data: {
        organizationId: orgId,
        conversationId: id,
        createdById: userId,
        kind: input.kind,
        scopeKind: input.scopeKind,
        scopeId: input.scopeId,
        ...schedule,
        status: "active",
        nextRunAt: nextTalkUpdateAt(schedule, now),
      },
    });
    await logActivity({
      type: "talk.update_created",
      actorId: userId,
      organizationId: orgId,
      description: `Set up a scheduled AI update in ${ctx.conversation.name ? `#${ctx.conversation.name}` : "a group chat"}`,
      targetId: id,
      targetType: "conversation",
      metadata: { updateId: row.id, kind: input.kind, scopeKind: input.scopeKind, cadence: input.cadence },
    });
    const [update] = await describeUpdates([row], { userId, organizationId: orgId, manageAll: true, linkViewer: me });
    return jsonSuccess({ update }, 201);
  } catch (err) {
    if (isMissingUpdatesTable(err)) return notReady();
    throw err;
  }
}
