// /api/notifications: the Inbox's one list, with tabs, a cursor, and an
// honest answer about whether you can still open what a row points at.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox, Data).
//
// WHAT WAS WRONG WITH THE OLD ROUTE, all four of which this fixes:
//
//   1. `take: 50` with no cursor and no total. The page then computed its four
//      tab counts by filtering that same 50-row array, so the tab counts and
//      the sidebar badge could not agree the moment anybody had 51 unread.
//   2. No tab routing. Tabs were decided client-side from a ten-entry hard-
//      coded map, so sixteen of the twenty-six types the app writes landed in
//      "Other" with no label.
//   3. Nothing about the target. A row pointing at a deleted task rendered an
//      Open button that 404'd, and the pane had no way to say why.
//   4. `PATCH { id }` ran `update({ where: { id } })` with no `userId`, so any
//      signed-in person who learned a cuid could mark somebody else's
//      notification read. Every sibling branch was already scoped; this one
//      was the exception. (Fixed in place before this rebuild, kept here.)
//
// TABS ARE SERVER-SIDE, from `inbox-kinds.ts`. Primary and Other are two
// disjoint `type IN (…)` lists over unsnoozed, UNCLEARED rows; Mentions is the
// mention types; Snoozed is `snoozedUntil > now`; Cleared is `clearedAt IS NOT
// NULL`. An unknown type (an automation author can write any string) is not in
// either `IN` list, so it would vanish, which is why Other is expressed as NOT
// IN the Primary list rather than IN the Other list. Nothing a person receives
// can fall out of every tab.
//
// READ IS NOT CLEARED (the fifth thing this route had wrong). The tabs used to
// be `read = false` and Cleared `read = true`, so the 1.5s auto-mark-read on
// the page took the row you were reading out of the list under your cursor and
// emptied the detail pane, "Mark read" was a silent "Clear", and "Mark all
// read" emptied Primary. A read row now STAYS in its tab, quieter; only Clear
// (`{ ids, cleared: true }`) files it away. See src/lib/inbox-query.ts.
//
// `?id=` answers one row by id, whatever tab it is in, so `/inbox?n=<id>`
// the URL every notification email lands on, can select a row that is not on
// the first page of the tab the viewer happens to have open.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getEffectivePreferences } from "@/lib/preferences";
import { FILTER_GROUPS, kindFor, parseTab, type InboxFilterGroup, type InboxTab } from "@/lib/inbox-kinds";
import {
  hasClearedAt,
  tabUnreadWhere,
  tabWhere,
  typesForGroups,
  unreadWhere,
  withClearedAtFallback,
} from "@/lib/inbox-query";
import { notificationTarget, type UnreadableReason } from "@/lib/notification-target";
import { readableTargets, targetKey } from "@/lib/notification-readability";
import type { Prisma } from "@/generated/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

function parseGroups(raw: string | null): InboxFilterGroup[] {
  const wanted = new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return FILTER_GROUPS.map((g) => g.key).filter((k) => wanted.has(k));
}

/** A cuid-ish opaque id. A cursor that is not one is a caller bug, not a page. */
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/** One notification as every reader here uses it. */
interface InboxRecord {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  snoozedUntil: Date | null;
  /** Absent for one release, on a database that has not had the column added. */
  clearedAt?: Date | null;
  createdAt: Date;
}

/**
 * The columns to read.
 *
 * Explicit rather than "the whole row" for one reason: `clearedAt` ships as an
 * additive column and the code may run for one release against a database
 * without it. Selecting a column that does not exist is an error Postgres
 * raises before any row comes back, so the select has to be able to drop it
 * and then `withClearedAtFallback` retries, this time without it, and the
 * Inbox renders on the old semantics instead of 500ing.
 */
function rowSelect(): Prisma.NotificationSelect {
  return {
    id: true,
    title: true,
    message: true,
    type: true,
    read: true,
    link: true,
    snoozedUntil: true,
    createdAt: true,
    ...(hasClearedAt() ? { clearedAt: true } : {}),
  };
}

/** The tab a single row belongs to, so `?n=<id>` can land on the right one. */
function tabForRow(
  row: { type: string; clearedAt?: Date | null; snoozedUntil: Date | null },
  now: Date,
): InboxTab {
  if (row.clearedAt) return "cleared";
  if (row.snoozedUntil && row.snoozedUntil > now) return "snoozed";
  const kind = kindFor(row.type);
  return kind.tab === "other" ? "other" : "primary";
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const organizationId = (session?.user as { organizationId?: string } | undefined)?.organizationId ?? "";
  const accessLevelForRow = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? null;
  const sp = req.nextUrl.searchParams;

  // ── one row by id ────────────────────────────────────────────────
  //
  // `/inbox?n=<id>` is the URL notification emails link to, and the Home
  // widget and the bell both use it. The page used to look for that id inside
  // the rows of whichever tab happened to be open, so a deep link to a row on
  // another tab, past the first page, or already read, selected nothing at
  // all. This answers the row itself, and says which tab it lives in.
  const wantedId = (sp.get("id") ?? "").trim();
  if (wantedId) {
    if (!ID_RE.test(wantedId)) return jsonError("Invalid id");
    const now = new Date();
    const row = (await withClearedAtFallback(() =>
      prisma.notification.findFirst({ where: { id: wantedId, userId }, select: rowSelect() }),
    )) as InboxRecord | null;
    if (!row) {
      // Not an error: a link from an old email whose row was deleted is a
      // thing that happens, and the page renders "This notification is gone".
      return NextResponse.json({ notification: null }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const target = notificationTarget(row.link);
    const readability = await readableTargets(userId, organizationId, [target], accessLevelForRow);
    return NextResponse.json(
      {
        notification: serialise(row, target, readability.get(targetKey(target))),
        tab: tabForRow(row, now),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const tab = parseTab(sp.get("tab"));
  const limit = parseLimit(sp.get("limit"));
  const cursor = sp.get("cursor");
  // A cursor is a row id this route handed out. A malformed one used to run as
  // a Prisma cursor that matched nothing and came back 200 with an empty page,
  // so the Inbox said "you're all caught up" over a total of 14.
  if (cursor !== null && !ID_RE.test(cursor)) return jsonError("Invalid cursor");
  const unreadOnly = sp.get("unread") === "1";
  const groups = parseGroups(sp.get("kinds"));
  const explicitType = (sp.get("type") ?? "").trim();
  // The viewer's "Show everything in Other" switch, passed from the client so
  // the server does not have to read a preference on every list request.
  const showAllInOther = sp.get("all") === "1";
  const now = new Date();

  const where: Prisma.NotificationWhereInput = tabWhere(tab, userId, now, showAllInOther);
  const and: Prisma.NotificationWhereInput[] = [];
  if (unreadOnly && tab !== "cleared") and.push({ read: false });
  if (groups.length) {
    and.push({ type: { in: typesForGroups(groups) } });
  }
  // `?type=` is the one-type form the /assigned-comments 308 lands on.
  if (explicitType) and.push({ type: explicitType });
  if (and.length) where.AND = and;

  const sortNewest = sp.get("sort") !== "oldest";

  const [rows, total, primaryUnread, otherUnread, mentionsUnread, snoozedCount, unreadTotal] =
    await withClearedAtFallback(() =>
      Promise.all([
        prisma.notification.findMany({
          where,
          select: rowSelect(),
          orderBy: [{ createdAt: sortNewest ? "desc" : "asc" }, { id: sortNewest ? "desc" : "asc" }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }) as unknown as Promise<InboxRecord[]>,
        prisma.notification.count({ where }),
        // The pills count UNREAD rows in each tab, which is what the spec asks
        // for ("Primary (count of unread)") and what the sidebar badge adds up.
        // The tab's own total is `total`, above.
        prisma.notification.count({ where: tabUnreadWhere("primary", userId, now) }),
        prisma.notification.count({ where: tabUnreadWhere("other", userId, now, showAllInOther) }),
        prisma.notification.count({ where: tabUnreadWhere("mentions", userId, now) }),
        prisma.notification.count({ where: tabWhere("snoozed", userId, now) }),
        // NOT `primary + other`. With "Show everything in Other" on, Other IS
        // every unread row, so the sum counted every Primary row twice and the
        // badge disagreed with itself. One clause, counted once.
        prisma.notification.count({ where: unreadWhere(userId, now) }),
      ]),
    );

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit && page.length ? page[page.length - 1].id : null;

  // One access pass over the distinct targets of this page, so the pane, the
  // Open button and the Enter key all answer from the same decision.
  const targets = page.map((n) => notificationTarget(n.link));
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? null;
  const readability = await readableTargets(userId, organizationId, targets, accessLevel);

  const out = page.map((n, i) => serialise(n, targets[i], readability.get(targetKey(targets[i]))));

  return NextResponse.json(
    {
      notifications: out,
      tab,
      total,
      nextCursor,
      hasMore: nextCursor !== null,
      counts: {
        primary: primaryUnread,
        other: otherUnread,
        mentions: mentionsUnread,
        snoozed: snoozedCount,
        // The ONE unread number, from the ONE clause `/api/inbox/count` and
        // `/api/boot` also read, so the badge, the bell and the tabs cannot
        // disagree.
        unread: unreadTotal,
      },
      // Kept for the handful of legacy readers (the bell popover's old shape).
      unreadCount: unreadTotal,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** One row, in the shape the Inbox list, the pane and the bell all read. */
function serialise(
  n: {
    id: string;
    title: string;
    message: string;
    type: string;
    read: boolean;
    link: string | null;
    snoozedUntil: Date | null;
    clearedAt?: Date | null;
    createdAt: Date;
  },
  target: ReturnType<typeof notificationTarget>,
  verdict: { readable: boolean; reason: UnreadableReason | null } | undefined,
) {
  const kind = kindFor(n.type);
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    type: kind.type,
    rawType: n.type,
    read: n.read,
    // `cleared` travels with the row so the list can show the Cleared tab's
    // "Move back to Inbox" action without a second question.
    cleared: hasClearedAt() ? n.clearedAt !== null && n.clearedAt !== undefined : n.read,
    link: n.link,
    snoozedUntil: n.snoozedUntil ? n.snoozedUntil.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    kind: { label: kind.label, icon: kind.icon, tab: kind.tab, filterGroup: kind.filterGroup },
    target: {
      kind: target.kind,
      id: target.id,
      href: target.href,
      anchor: target.anchor,
      anchorIsComment: target.anchorIsComment,
      // A target with nothing to check (an external href, or no link at all)
      // is openable; only a named object we looked up can be unreadable.
      readable: verdict ? verdict.readable : true,
      reason: verdict === undefined ? null : verdict.reason,
    },
  };
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const organizationId = (session?.user as { organizationId?: string } | undefined)?.organizationId ?? "";
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const now = new Date();

  // Tab-scoped "Mark all read" (spec: per tab, with an Undo toast). A bare
  // `markAllRead` with no tab keeps meaning everything, which is what the bell
  // popover's "Clear all" sends.
  if (body.markAllRead) {
    const tab = typeof body.tab === "string" ? parseTab(body.tab) : null;
    const where: Prisma.NotificationWhereInput = tab
      ? tabUnreadWhere(tab, userId, now)
      : { userId, read: false };
    // The ids come back so the Undo toast can put them back unread. Bounded:
    // an Undo that would have to remember 10,000 rows is not an Undo.
    //
    // `undoable` is the honest half of that: past the cap the client is told
    // not to offer an Undo at all, rather than offering one that silently
    // restores the first 500 rows and leaves the rest read with no way back.
    const UNDO_CAP = 500;
    const { affected, result } = await withClearedAtFallback(async () => ({
      affected: await prisma.notification.findMany({ where, select: { id: true }, take: UNDO_CAP }),
      result: await prisma.notification.updateMany({ where, data: { read: true } }),
    }));
    return jsonSuccess({
      message: "Marked as read",
      count: result.count,
      ids: affected.map((r) => r.id),
      undoable: result.count <= UNDO_CAP,
    });
  }

  // Clear / un-clear. THE ONE WRITE THAT FILES A ROW AWAY, and the only
  // difference between the Inbox's three row actions that used to be two.
  // Clearing also marks the row read (spec: "Clear (`Check`: marks read AND
  // moves to Cleared)"); un-clearing (the Undo, and the Cleared tab's "Move
  // back to Inbox") puts it back where it was and leaves the read weight to
  // the caller, which knows what it was before.
  if (Object.prototype.hasOwnProperty.call(body, "cleared")) {
    const ids = collectIds(body);
    if (ids.length === 0) return jsonError("Provide id or ids to clear");
    const cleared = body.cleared !== false;
    if (!hasClearedAt()) {
      // One release of tolerance: without the column, Clear is what it always
      // was, a mark-read. Nothing is lost and nothing 500s.
      const r = await prisma.notification.updateMany({
        where: { id: { in: ids }, userId },
        data: { read: cleared },
      });
      return jsonSuccess({ message: cleared ? "Cleared" : "Moved back to Inbox", count: r.count, ids });
    }
    const r = await withClearedAtFallback(() =>
      prisma.notification.updateMany({
        where: { id: { in: ids }, userId },
        data: cleared ? { clearedAt: now, read: true } : { clearedAt: null },
      }),
    );
    return jsonSuccess({ message: cleared ? "Cleared" : "Moved back to Inbox", count: r.count, ids });
  }

  if (typeof body.markAllReadOfType === "string" && body.markAllReadOfType.length > 0) {
    const result = await prisma.notification.updateMany({
      where: { userId, read: false, type: body.markAllReadOfType },
      data: { read: true },
    });
    return jsonSuccess({ message: "Type marked as read", count: result.count });
  }

  // Snooze is checked BEFORE the read branch, because a body carrying both an
  // id and a snoozeUntil used to mark the row read and never snooze it, which
  // is why the Inbox page had to send `ids: [id]` to reach the snooze branch at
  // all. One body, one meaning: if it says snooze, it snoozes.
  if (Object.prototype.hasOwnProperty.call(body, "snoozeUntil")) {
    const raw = body.snoozeUntil;
    let value: Date | null;
    if (raw === null || raw === "") {
      value = null;
    } else {
      const parsed = new Date(raw as string);
      if (isNaN(parsed.getTime())) return jsonError("Invalid snoozeUntil");
      value = parsed;
    }
    const ids = collectIds(body);
    if (ids.length === 0) return jsonError("Provide id or ids to snooze");
    const r = await prisma.notification.updateMany({
      where: { id: { in: ids }, userId },
      data: { snoozedUntil: value },
    });
    return jsonSuccess({ snoozed: r.count, until: value });
  }

  // Mark read OR UNREAD. `read: false` is new: the Inbox row's `u` shortcut and
  // its "Mark unread" hover action had no endpoint before, so the action was
  // drawn and did nothing.
  const ids = collectIds(body);
  if (ids.length > 0) {
    const read = body.read === undefined ? true : body.read === true;
    // SCOPED TO THE CALLER. updateMany is what makes the scope expressible, and
    // a count of 0 for somebody else's id is the same answer as for an id that
    // does not exist, so nothing here confirms that a row is real.
    const r = await prisma.notification.updateMany({ where: { id: { in: ids }, userId }, data: { read } });
    return jsonSuccess({ message: read ? "Marked as read" : "Marked as unread", count: r.count, ids });
  }

  void organizationId;
  return jsonError("Invalid request");
}

function collectIds(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof body.id === "string" && body.id) out.push(body.id);
  if (Array.isArray(body.ids)) {
    for (const v of body.ids) if (typeof v === "string" && v) out.push(v);
  }
  return Array.from(new Set(out));
}

/**
 * DELETE: remove notifications. Always scoped to the current user.
 *
 *   { id }                          one row
 *   { ids: [] }                     a batch
 *   { allRead: true }               every CLEARED row
 *   { allRead: true, olderThanDays} the auto-clear sweep the daily cron runs,
 *                                   reading `inboxView.autoClearDays`
 *
 * "allRead" keeps its name because callers send it, but it sweeps rows the
 * person CLEARED, not rows they merely read. Now that those are two states, a
 * read row still sits in Primary where its owner can see it, and deleting it
 * from under them because a cron ran would be exactly the data loss this whole
 * change exists to stop.
 */
export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const organizationId = (session?.user as { organizationId?: string } | undefined)?.organizationId ?? "";
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const ids = collectIds(body);
  if (ids.length > 0) {
    const r = await prisma.notification.deleteMany({ where: { id: { in: ids }, userId } });
    return jsonSuccess({ deleted: r.count });
  }

  if (body.allRead === true) {
    // The viewer's own setting decides the age, unless the caller names one.
    let olderThanDays: number | null = typeof body.olderThanDays === "number" ? body.olderThanDays : null;
    if (olderThanDays === null && organizationId) {
      const prefs = await getEffectivePreferences(userId, organizationId).catch(() => null);
      const stored = (prefs?.home?.notifications?.inboxView as { autoClearDays?: number } | undefined)?.autoClearDays;
      olderThanDays = typeof stored === "number" && stored > 0 ? stored : null;
    }
    const r = await withClearedAtFallback(() => {
      const where: Prisma.NotificationWhereInput = hasClearedAt()
        ? { userId, clearedAt: { not: null } }
        : { userId, read: true };
      if (olderThanDays !== null && olderThanDays > 0) {
        where.createdAt = { lt: new Date(Date.now() - olderThanDays * 86_400_000) };
      }
      return prisma.notification.deleteMany({ where });
    });
    return jsonSuccess({ deleted: r.count, olderThanDays });
  }

  return jsonError("Provide id, ids, or allRead");
}
