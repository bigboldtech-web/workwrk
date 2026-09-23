import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonSuccess } from "@/lib/api-helpers";
import { talkGate } from "@/lib/talk-gate";

// GET /api/conversations/browse?q=&scope=join|all: the Browse channels dialog
// (spec-talk.md section 3).
//
// TWO TABS, TWO DIFFERENT QUESTIONS, and the difference is the whole point:
//
//   scope=join  "Channels you can join": public, findable, not archived, and
//               not one I am already in. Every Member sees this; a Guest never
//               browses at all.
//   scope=all   "All channels", Owners and Admins only: EVERY channel in the
//               organization including private and archived ones, so somebody
//               can archive an abandoned private channel. It returns a name, a
//               member count and the archived flag and NOTHING ELSE: no topic,
//               no members, no last message, no preview. Access rule 3 says an
//               Owner may not read a private channel, and a list that leaked
//               its topic would be reading it in instalments.
//
// A non-admin asking for scope=all gets the join list instead of a 403: there
// is no secret to keep (they know channels exist) and a 403 on a tab that
// simply does not render for them would only ever be a stale tab.

export async function GET(req: NextRequest) {
  const { error, gate } = await talkGate();
  if (error) return error;

  if (gate.orgRole === "GUEST") {
    // A Guest holds exactly the channels they were handed and browses nothing.
    return jsonSuccess({ channels: [], scope: "join", canSeeAll: false });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const canSeeAll = gate.orgRole === "OWNER" || gate.orgRole === "ADMIN";
  const scope = searchParams.get("scope") === "all" && canSeeAll ? "all" : "join";

  const mine = await prisma.conversationMember.findMany({
    where: { userId: gate.userId, conversation: { organizationId: gate.organizationId, type: "CHANNEL" } },
    select: { conversationId: true },
  });
  const mineSet = new Set(mine.map((m) => m.conversationId));

  const rows = await prisma.conversation.findMany({
    where: {
      organizationId: gate.organizationId,
      type: "CHANNEL",
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      ...(scope === "join"
        ? { restricted: false, findable: true, archivedAt: null, id: { notIn: [...mineSet] } }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      topic: true,
      restricted: true,
      findable: true,
      archivedAt: true,
      createdById: true,
      _count: { select: { members: true } },
    },
  });

  return jsonSuccess({
    scope,
    canSeeAll,
    channels: rows.map((r) => ({
      id: r.id,
      name: r.name,
      // The topic is a public channel's description and is withheld on a
      // private one even from an Owner, for the reason in the header above.
      topic: r.restricted ? null : r.topic,
      restricted: r.restricted,
      findable: r.findable,
      archived: r.archivedAt != null,
      memberCount: r._count.members,
      joined: mineSet.has(r.id),
      isOwner: r.createdById === gate.userId,
    })),
  });
}
