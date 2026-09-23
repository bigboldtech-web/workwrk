import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { conversationNotFound, loadConversationRole, needFullAccess, talkGate } from "@/lib/talk-gate";
import {
  canEditTopic,
  canLeave,
  canRename,
  canSetVisibility,
  isGeneralChannel,
} from "@/lib/talk-access";
import { CHAT_GUEST_CODE_TTL_MS, chatGuestCode, chatRoomName } from "@/lib/meeting-room";

// One conversation: meta + members + the derived call room + what I may do.
//
// Membership is the only key for a read: a non-member gets 404, not 403, so
// conversation existence never leaks. The ONE exception is a findable public
// channel, which answers 200 with `role: "none"` and `joinable: true` so the
// page can render the Join screen instead of a 404 for a channel the person is
// allowed to walk into. That is decided by src/lib/talk-access.ts, not here.
//
// PHASE 4: the management writes (topic, restricted, findable, archived,
// rename) are Full-access only, and #general refuses all five. Before this,
// any member could rename any channel.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, gate } = await talkGate();
  if (error) return error;
  const { id } = await params;

  const ctx = await loadConversationRole(id, gate);
  if (!ctx) return conversationNotFound();
  if (ctx.role === "none" && !ctx.joinable) return conversationNotFound();

  const members = await prisma.conversationMember.findMany({
    where: { conversationId: id },
    select: {
      userId: true,
      notifyLevel: true,
      starred: true,
      joinedAt: true,
      user: {
        select: {
          id: true, firstName: true, lastName: true, avatar: true, email: true,
          // The Details panel's DM card shows a job title and a department.
          // There is no `User.jobTitle` column: the title lives on the Role
          // row the person holds, which is where /people reads it from too.
          role: { select: { title: true } },
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  // A joinable non-member sees the door, not the room: name, member count and
  // owner only. Nothing about who is in it and nothing about what was said.
  if (ctx.role === "none") {
    const owner = ctx.conversation.createdById
      ? members.find((m) => m.userId === ctx.conversation.createdById)?.user ?? null
      : null;
    return jsonSuccess({
      id: ctx.conversation.id,
      type: ctx.conversation.type,
      name: ctx.conversation.name,
      topic: ctx.conversation.topic,
      restricted: ctx.conversation.restricted,
      findable: ctx.conversation.findable,
      archivedAt: ctx.conversation.archivedAt,
      createdById: ctx.conversation.createdById,
      memberCount: members.length,
      owner: owner ? { id: owner.id, name: `${owner.firstName} ${owner.lastName}`.trim() } : null,
      role: "none",
      joinable: true,
      members: [],
      call: null,
      activeCall: null,
    });
  }

  const room = chatRoomName(id, ctx.conversation.callEpoch);

  // Live call roster for the header chip (12h staleness cap, ghost-proof).
  let activeCall: { participants: { identity: string; name: string }[]; startedAt: Date } | null = null;
  try {
    // A conversation can briefly hold several open sessions (an epoch rotation
    // mid-call splits rooms): surface the one people are actually IN, not
    // merely the newest row.
    const sessions = await prisma.callSession.findMany({
      where: { conversationId: id, endedAt: null, startedAt: { gt: new Date(Date.now() - 12 * 3600_000) } },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { participants: true, startedAt: true },
    });
    const live = sessions.find((x) => Array.isArray(x.participants) && (x.participants as unknown[]).length > 0);
    if (live) {
      activeCall = { participants: live.participants as { identity: string; name: string }[], startedAt: live.startedAt };
    }
  } catch (e) { console.error("active call lookup failed", e); }

  // THE OWNER, for a MEMBER too. This branch never returned one, so three
  // things quietly lost a name: the start-of-history line ("Created by Anita
  // Rao · 4 Sep", spec 2.2), the archived banner's "Ask {owner} to restore",
  // and the Details panel's Owner marker. The creator may have left the
  // conversation, so the member list is tried first and the user row second
  // rather than the line simply disappearing when they do.
  let owner: { id: string; name: string } | null = null;
  if (ctx.conversation.createdById) {
    const inRoom = members.find((m) => m.userId === ctx.conversation.createdById)?.user;
    const u = inRoom ?? await prisma.user.findFirst({
      where: { id: ctx.conversation.createdById, organizationId: gate.organizationId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (u) owner = { id: u.id, name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Someone" };
  }

  const base = process.env.NEXTAUTH_URL || "https://workwrk.com";
  const guestExpiresAt = Date.now() + CHAT_GUEST_CODE_TTL_MS;
  return jsonSuccess({
    owner,
    id: ctx.conversation.id,
    type: ctx.conversation.type,
    name: ctx.conversation.name,
    topic: ctx.conversation.topic,
    restricted: ctx.conversation.restricted,
    findable: ctx.conversation.findable,
    archivedAt: ctx.conversation.archivedAt,
    createdById: ctx.conversation.createdById,
    createdAt: ctx.conversation.createdAt,
    role: ctx.role,
    joinable: false,
    members,
    call: {
      room,
      guestUrl: `${base}/meet/${chatGuestCode(id, ctx.conversation.callEpoch, guestExpiresAt)}`,
      // The caption on the Guest link row reads this rather than repeating
      // "24 hours" as a string that would go stale if the TTL ever moves.
      guestExpiresAt: new Date(guestExpiresAt).toISOString(),
    },
    activeCall,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, gate } = await talkGate();
  if (error) return error;
  const { id } = await params;

  const ctx = await loadConversationRole(id, gate);
  if (!ctx || ctx.role === "none") return conversationNotFound();
  const c = ctx.conversation;

  const body = await req.json().catch(() => null);

  // VALIDATE EVERYTHING FIRST: nothing may apply if any part 400s or 403s.
  // (A member's `hidden` used to commit before a rename was rejected.)
  let validatedName: string | null = null;
  if (typeof body?.name === "string") {
    if (!canRename(c, ctx.role)) {
      if (c.type === "DM") return jsonError("Direct messages can't be renamed", 400);
      if (isGeneralChannel(c)) return jsonError("#general is the company channel and can't be renamed", 400);
      return needFullAccess("rename this");
    }
    const name = body.name.trim().replace(/^#/, "").slice(0, 80);
    if (!name) return jsonError("Name can't be empty", 400);
    if (c.type === "CHANNEL") {
      const clash = await prisma.conversation.findFirst({
        where: {
          organizationId: gate.organizationId,
          type: "CHANNEL",
          name: { equals: name, mode: "insensitive" },
          id: { not: id },
        },
        select: { id: true },
      });
      if (clash) return jsonError("A channel with that name already exists", 400);
    }
    validatedName = name;
  }

  let validatedTopic: string | null | undefined;
  if (body?.topic !== undefined) {
    if (!canEditTopic(c, ctx.role)) return needFullAccess("change the topic");
    if (body.topic === null || body.topic === "") validatedTopic = null;
    else if (typeof body.topic === "string") validatedTopic = body.topic.trim().slice(0, 280);
    else return jsonError("Topic must be text", 400);
  }

  let validatedRestricted: boolean | undefined;
  let validatedFindable: boolean | undefined;
  if (typeof body?.restricted === "boolean" || typeof body?.findable === "boolean") {
    if (!canSetVisibility(c, ctx.role)) {
      if (isGeneralChannel(c)) return jsonError("#general is open to everyone and can't be made private", 400);
      return needFullAccess("change who can find this channel");
    }
    if (typeof body.restricted === "boolean") validatedRestricted = body.restricted;
    if (typeof body.findable === "boolean") validatedFindable = body.findable;
  }

  let validatedArchived: Date | null | undefined;
  if (typeof body?.archived === "boolean") {
    // Archive and Restore are the same right, and they stay available on an
    // already-archived row or nothing could ever come back.
    if (c.type !== "CHANNEL") return jsonError("Only channels can be archived", 400);
    if (isGeneralChannel(c)) return jsonError("#general is the company channel and can't be archived", 400);
    if (ctx.role !== "full") return needFullAccess(body.archived ? "archive this channel" : "restore this channel");
    validatedArchived = body.archived ? new Date() : null;
  }

  if (typeof body?.notifyLevel === "string" && !["all", "mentions", "mute"].includes(body.notifyLevel)) {
    return jsonError("Invalid notify level", 400);
  }

  // The three per-member writes are always self-service, and only exist for
  // somebody who actually has a membership row.
  if (ctx.membershipId) {
    const mine: Record<string, unknown> = {};
    if (typeof body?.hidden === "boolean") mine.hidden = body.hidden;
    if (typeof body?.starred === "boolean") mine.starred = body.starred;
    if (typeof body?.notifyLevel === "string") mine.notifyLevel = body.notifyLevel;
    if (Object.keys(mine).length > 0) {
      await prisma.conversationMember.update({ where: { id: ctx.membershipId }, data: mine });
    }
  }

  const conversationData: Record<string, unknown> = {};
  if (validatedName !== null) conversationData.name = validatedName;
  if (validatedTopic !== undefined) conversationData.topic = validatedTopic;
  if (validatedRestricted !== undefined) conversationData.restricted = validatedRestricted;
  if (validatedFindable !== undefined) conversationData.findable = validatedFindable;
  if (validatedArchived !== undefined) conversationData.archivedAt = validatedArchived;
  if (Object.keys(conversationData).length > 0) {
    await prisma.conversation.update({ where: { id }, data: conversationData });
  }

  return jsonSuccess({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, gate } = await talkGate();
  if (error) return error;
  const { id } = await params;

  const ctx = await loadConversationRole(id, gate);
  if (!ctx || !ctx.membershipId) return conversationNotFound();
  const c = ctx.conversation;

  if (c.type === "DM") return jsonError("Direct messages can't be left, close them instead", 400);
  if (isGeneralChannel(c)) {
    // Everyone belongs in the company channel (the Slack model), and the
    // channel directory would auto-rejoin them within one poll anyway, which
    // would silently wipe their read state. An honest refusal beats a fake
    // leave.
    return jsonError("Everyone's in #general, mute it instead of leaving", 400);
  }
  if (!canLeave(c, ctx.viewer)) return jsonError("You can't leave this conversation", 400);

  // Leaving = removing my membership. Messages stay (data integrity).
  // The epoch bump rotates the derived call room so the departing member's
  // captured room name cannot rejoin a future call.
  await prisma.$transaction([
    prisma.conversationMember.delete({ where: { id: ctx.membershipId } }),
    prisma.conversation.update({ where: { id }, data: { callEpoch: { increment: 1 } } }),
  ]);
  return jsonSuccess({ ok: true });
}
