import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";
import { giveKudos } from "@/lib/kudos-give";
import { toCsv } from "@/lib/people/people-csv";
import type { Prisma } from "@/generated/prisma";

// GET: the kudos feed (spec-teams-performance /kudos Data).
//
//   view=all|received|given   received and given are the VIEWER's own
//   userId=&direction=received|given   one person's kudos (a record's tab)
//   value=<word>|none, q=<text in the message>, person=<giver or receiver>
//   from=&to= (YYYY-MM-DD), sort=recent|reactions
//   id=<kudos id>   that one kudos (a Copy link lands on it), same payload
//   cursor=<opaque> & limit (at most 50): cursor pagination for the feed;
//   page & limit still work for the person record's "Show more".
//
// `pagination.total` is the server's count over the whole filtered set,
// never the loaded page, and `reactions` the reactions on that same set.
// Guests never read the feed (access 3.3 Kudos).
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const viewer = await viewerFromSession();
  if (viewer?.orgRole === "GUEST") return jsonError("Not found", 404);
  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  const userId = url.searchParams.get("userId");
  const direction = url.searchParams.get("direction") === "given" ? "given" : "received";
  const givenBy = url.searchParams.get("givenBy");
  const idParam = url.searchParams.get("id");
  const value = url.searchParams.get("value");
  const q = (url.searchParams.get("q") ?? "").trim();
  const person = url.searchParams.get("person");
  const dept = url.searchParams.get("dept");
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const sort = url.searchParams.get("sort") === "reactions" ? "reactions" : "recent";
  const cursor = url.searchParams.get("cursor");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20), 50);

  const where: Prisma.KudosWhereInput = { organizationId: orgId };
  const and: Prisma.KudosWhereInput[] = [];
  if (view === "received") where.receiverId = currentUserId;
  else if (view === "given") where.giverId = currentUserId;
  if (userId) {
    if (direction === "given") where.giverId = userId;
    else where.receiverId = userId;
  }
  if (givenBy) where.giverId = givenBy;
  if (idParam) where.id = idParam;
  if (value === "none") where.companyValue = null;
  else if (value) where.companyValue = value;
  if (q) where.message = { contains: q, mode: "insensitive" };
  if (person) and.push({ OR: [{ giverId: person }, { receiverId: person }] });
  if (dept) and.push({ OR: [{ giver: { departmentId: dept } }, { receiver: { departmentId: dept } }] });
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if ((fromRaw && DATE.test(fromRaw)) || (toRaw && DATE.test(toRaw))) {
    where.createdAt = {
      ...(fromRaw && DATE.test(fromRaw) ? { gte: new Date(`${fromRaw}T00:00:00.000Z`) } : {}),
      ...(toRaw && DATE.test(toRaw) ? { lte: new Date(`${toRaw}T23:59:59.999Z`) } : {}),
    };
  }
  if (and.length) where.AND = and;

  // Cursor. Newest first pages by KEYSET ("k:{createdAt ms}:{id}", the last
  // row's sort key), so a kudos arriving or deleted between two pages never
  // repeats or skips a row. Most reactions pages by offset (a reaction
  // count moves under the reader, so no key is stable); the client drops
  // repeats by id. A bare number is an offset under either sort (the older
  // clients' cursor).
  const keyset = sort === "recent" && cursor ? /^k:(\d+):(.+)$/.exec(cursor) : null;
  const offset = keyset ? 0 : cursor && /^\d+$/.test(cursor) ? Number(cursor) : (page - 1) * limit;
  const pageWhere: Prisma.KudosWhereInput = keyset
    ? {
        AND: [
          where,
          {
            OR: [
              { createdAt: { lt: new Date(Number(keyset[1])) } },
              { createdAt: new Date(Number(keyset[1])), id: { lt: keyset[2] } },
            ],
          },
        ],
      }
    : where;
  const orderBy: Prisma.KudosOrderByWithRelationInput[] = sort === "reactions"
    ? [{ reactions: { _count: "desc" } }, { createdAt: "desc" }, { id: "desc" }]
    : [{ createdAt: "desc" }, { id: "desc" }];

  const isAdmin = viewer?.orgRole === "OWNER" || viewer?.orgRole === "ADMIN";
  const isAgent = viewer?.isAgent === true;

  // Export CSV: the People team and Admin, never an Agent; every row the
  // filters hold, not the page.
  if (url.searchParams.get("format") === "csv") {
    if (isAgent || !(isAdmin || viewer?.peopleTeam)) return jsonError("Only the People team or an Admin can export kudos", 403);
    const all = await prisma.kudos.findMany({
      where,
      orderBy,
      select: {
        createdAt: true, message: true, companyValue: true,
        giver: { select: { firstName: true, lastName: true, email: true } },
        receiver: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { reactions: true } },
      },
    });
    const csv = toCsv(
      ["Date", "From", "From email", "To", "To email", "Company value", "Message", "Reactions"],
      all.map((k) => [
        k.createdAt.toISOString(),
        `${k.giver.firstName ?? ""} ${k.giver.lastName ?? ""}`.trim(), k.giver.email,
        `${k.receiver.firstName ?? ""} ${k.receiver.lastName ?? ""}`.trim(), k.receiver.email,
        k.companyValue ?? "", k.message, k._count.reactions,
      ]),
    );
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="kudos.csv"', "Cache-Control": "no-store" } });
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [kudos, total, thisWeek, reactionsTotal] = await Promise.all([
    prisma.kudos.findMany({
      where: pageWhere,
      include: {
        giver: {
          select: { id: true, firstName: true, lastName: true, avatar: true, role: { select: { title: true } } },
        },
        receiver: {
          select: { id: true, firstName: true, lastName: true, avatar: true, role: { select: { title: true } }, department: { select: { name: true } } },
        },
        reactions: {
          select: { emoji: true, userId: true },
        },
      },
      orderBy,
      skip: offset,
      take: limit,
    }),
    prisma.kudos.count({ where }),
    // The feed's "This week" group count, over the whole filtered set.
    prisma.kudos.count({ where: { AND: [where, { createdAt: { gte: weekAgo } }] } }),
    // The old tile strip's Reactions number, over the same filtered set.
    prisma.kudosReaction.count({ where: { kudos: where } }),
  ]);
  // The giver's presence dot. presenceStatus is additive (prisma/sql
  // 2026-09-26-phase6-people.sql): a database without it shows no dot.
  const presence = new Map<string, { presenceStatus: string | null; presenceUntil: string | null }>();
  try {
    const ids = [...new Set(kudos.map((k) => k.giverId))];
    if (ids.length) {
      const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, presenceStatus: true, presenceUntil: true } });
      for (const r of rows) presence.set(r.id, { presenceStatus: r.presenceStatus ?? null, presenceUntil: r.presenceUntil ? r.presenceUntil.toISOString() : null });
    }
  } catch {
    // Column absent for one release: no dots.
  }
  const shaped = kudos.map((k) => {
    const byEmoji = new Map<string, number>();
    const mine: string[] = [];
    for (const r of k.reactions) {
      byEmoji.set(r.emoji, (byEmoji.get(r.emoji) || 0) + 1);
      if (r.userId === currentUserId) mine.push(r.emoji);
    }
    const reactionCounts = Array.from(byEmoji.entries())
      .map(([emoji, count]) => ({ emoji, count }))
      .sort((a, b) => b.count - a.count);
    return {
      id: k.id,
      message: k.message,
      companyValue: k.companyValue,
      giver: { ...k.giver, ...(presence.get(k.giverId) ?? {}) },
      receiver: k.receiver,
      createdAt: k.createdAt,
      reactionCounts,
      totalReactions: k.reactions.length,
      myReactions: mine,
      // The giver and an Admin may delete, never an Agent (access 3.3).
      canDelete: !isAgent && (k.giverId === currentUserId || isAdmin),
    };
  });

  let nextCursor: string | null = null;
  if (kudos.length === limit) {
    if (sort === "recent" && (keyset || !url.searchParams.get("page"))) {
      const last = kudos[kudos.length - 1];
      // Only when rows remain past this key (a full page can be the last).
      const more = await prisma.kudos.count({
        where: { AND: [where, { OR: [{ createdAt: { lt: last.createdAt } }, { createdAt: last.createdAt, id: { lt: last.id } }] }] },
        take: 1,
      });
      nextCursor = more > 0 ? `k:${last.createdAt.getTime()}:${last.id}` : null;
    } else {
      const next = offset + kudos.length;
      nextCursor = next < total ? String(next) : null;
    }
  }
  return jsonSuccess({
    data: shaped,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      nextCursor,
    },
    groups: { thisWeek, earlier: Math.max(0, total - thisWeek) },
    reactions: reactionsTotal,
  });
}

// POST: Send kudos
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const giverId = getUserId(session);
  // A Guest never gives kudos (access 3.3 Kudos: every Member EDIT).
  const viewer = await viewerFromSession();
  if (viewer?.orgRole === "GUEST") return jsonError("Not found", 404);
  const body = await req.json().catch(() => ({}));
  const { receiverId, message } = body as { receiverId?: string; message?: unknown };
  const companyValue = typeof body.companyValue === "string" && body.companyValue.trim() ? body.companyValue.trim().slice(0, 80) : null;

  if (!receiverId || typeof message !== "string" || !message.trim()) {
    return jsonError("Choose who to thank and write a message");
  }

  // The rules and everything that follows a kudos live in one place
  // (src/lib/kudos-give.ts), shared with Ask AI and the public API.
  const given = await giveKudos({ organizationId: orgId, giverId, receiverId, message, companyValue });
  if (!given.ok) return jsonError(given.error, given.status);
  if (given.duplicate) return jsonSuccess({ ...given.kudos, duplicate: true }, 200);
  return jsonSuccess(given.kudos, 201);
}
