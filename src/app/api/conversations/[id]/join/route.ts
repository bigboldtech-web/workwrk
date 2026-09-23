import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { conversationNotFound, loadConversationRole, talkGate } from "@/lib/talk-gate";
import { isArchived } from "@/lib/talk-access";

// Self-service join, CHANNELS ONLY. A public channel is open to everyone in
// the organization; DMs and groups stay invite-only.
//
// PHASE 4: private channels exist, and so does archiving, so "channel" is no
// longer enough on its own.
//
//   * A RESTRICTED channel 404s exactly as an id that does not exist does.
//     Answering "you may not join that" would confirm the channel is there,
//     which is the one thing a private channel must not do (access rule 3).
//   * An ARCHIVED channel refuses with a sentence, because its existence is
//     not a secret: it is in Browse channels for Owners and Admins, and the
//     person clicking Join can see its name.
//   * A channel with `findable = false` is still joinable by id: an admin
//     hiding it from Browse is saying "do not advertise this", not "nobody
//     may walk in with the link". Restricted is the switch that means that.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, gate } = await talkGate();
  if (error) return error;
  const { id } = await params;

  const ctx = await loadConversationRole(id, gate);
  if (!ctx) return conversationNotFound();
  if (ctx.membershipId) return jsonSuccess({ ok: true, alreadyMember: true });

  const c = ctx.conversation;
  if (c.type !== "CHANNEL") return conversationNotFound();
  if (c.restricted) return conversationNotFound();
  if (gate.orgRole === "GUEST") return conversationNotFound();
  if (isArchived(c)) return jsonError("This channel is archived. Ask a workspace admin to restore it.", 400);

  // Channel memberships default to mention-only bells (Slack parity); unread
  // badges still count everything.
  await prisma.conversationMember.createMany({
    data: [{ conversationId: id, userId: gate.userId, notifyLevel: "mentions" }],
    skipDuplicates: true,
  });

  return jsonSuccess({ ok: true });
}
