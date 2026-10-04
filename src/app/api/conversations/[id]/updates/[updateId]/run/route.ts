// POST /api/conversations/[id]/updates/[updateId]/run   Post now
//
// Runs one update at once, by the same steps as its schedule
// (src/lib/talk-updates-server.ts runTalkUpdate). Only the person it posts as
// may press it: a post written as somebody is never started by somebody
// else. At most once in MANUAL_COOLDOWN_MS, claimed by one compare-and-swap
// on TalkUpdate.lastManualAt, so two presses at once never both post.
//
// Answers { posted: true, messageId, taskCount } or { posted: false, reason,
// message }: a run that had nothing to say is an answer, not an error.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requireApp } from "@/lib/app-gate";
import { requireConversation } from "@/lib/talk-gate";
import { canPost } from "@/lib/talk-access";
import { REASON_TEXT } from "@/lib/talk-updates";
import { BEFORE_AI_REASONS, claimManualRun, isMissingUpdatesTable, releaseManualRun, runTalkUpdate } from "@/lib/talk-updates-server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const app = await requireApp("ai");
  if ("error" in app) return app.error;
  const { id, updateId } = await params;
  const { error, ctx } = await requireConversation(id, { floor: "edit", allow: canPost, what: "post here" });
  if (error) return error;
  try {
    const row = await prisma.talkUpdate.findFirst({ where: { id: updateId, conversationId: id, organizationId: ctx.gate.organizationId } });
    if (!row) return jsonError("That update no longer exists.", 404);
    if (row.createdById !== ctx.viewer.userId) return jsonError("Only the person this update posts as can post it now.", 403);
    if (row.status !== "active") return jsonError("This update is paused. Resume it first.", 409);
    const now = new Date();
    const claim = await claimManualRun(row.id, now);
    if (!claim.ok) return jsonSuccess({ posted: false, reason: claim.reason, message: REASON_TEXT[claim.reason] });
    // The press's own instant (never on a whole minute, where a scheduled
    // slot's run row lives): the lastManualAt claim already stops two presses.
    const pressedAt = now.getTime() % 60_000 === 0 ? new Date(now.getTime() + 1) : now;
    const out = await runTalkUpdate({ update: row, trigger: "manual", dueAt: pressedAt, now });
    if (out.status === "posted") return jsonSuccess({ posted: true, messageId: out.messageId, taskCount: out.taskCount });
    // Stopped before the AI was asked: the next press need not wait.
    if (BEFORE_AI_REASONS.has(out.reason)) await releaseManualRun(row.id, now, claim.previous);
    return jsonSuccess({ posted: false, reason: out.reason, message: REASON_TEXT[out.reason] });
  } catch (err) {
    if (isMissingUpdatesTable(err)) return jsonError("Scheduled updates aren't ready on this server yet.", 503);
    throw err;
  }
}
