// GET /api/me/home: everything the Home page draws, in ONE call.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/home, Data):
// `{ work, inbox, reminders, goals, weeklyReview, recentDocs }` "composed
// server-side from the existing helpers behind /api/me/work (widened to
// assigneeIds), /api/notifications, /api/reminders, /api/okrs/my-okrs,
// /api/me/weekly-review, /api/me/recent-docs, scoped by can()".
//
// ONE CALL, ON PURPOSE. The page it replaces fired four fetches from four
// cards and rendered seven more from hard-coded strings. Six widgets firing
// six requests on every focus is the same mistake with better manners, and it
// makes "focus re-fetches everything" (the spec's Realtime line) six races
// instead of one.
//
// EVERY WIDGET FAILS ALONE. A widget whose data could not be read comes back
// as `null` and renders "Couldn't load · Retry" in its own body. The page is
// never empty because one query was slow, and it never claims Inbox Zero
// because a count threw: which is the exact failure the old Inbox had.
//
// GUESTS GET TWO WIDGETS. Access section 5.2.1's `home` row grants a Guest
// "My work over shared objects, Inbox" and nothing else, so the other four
// keys come back null for a Guest rather than being computed and hidden by the
// client. Nothing about a person's goals, reminders, reviews or documents
// leaves the server for someone the workspace does not keep those for.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEffectivePreferences } from "@/lib/preferences";
import { getBoardStatuses, isDoneStatusName } from "@/lib/board-items-shared";
import { docAccessible } from "@/lib/doc-access";
import { homeBucketFor, endOfWeekInstant, type LocaleContext } from "@/lib/work-buckets";
import { kindFor } from "@/lib/inbox-kinds";
import { tabUnreadWhere, unreadWhere, withClearedAtFallback } from "@/lib/inbox-query";
import { notificationTarget } from "@/lib/notification-target";
import type { HomePayload, HomeTaskRow } from "@/lib/home-payload";

export const dynamic = "force-dynamic";

/** At most ten task rows across the three groups (spec: the content budget). */
const WORK_ROW_BUDGET = 10;

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = u.id;
  const organizationId = u.organizationId;
  const isGuest = (u.accessLevel ?? "").toUpperCase() === "GUEST";

  const prefs = await getEffectivePreferences(userId, organizationId).catch(() => null);
  const locale: LocaleContext = {
    timeZone: prefs?.home?.locale?.timezone ?? null,
    weekStart: prefs?.home?.locale?.weekStart ?? null,
  };
  const now = new Date();

  // `settled` rather than `all`: one widget's failure is that widget's error
  // row, never the page's.
  const [work, inbox, reminders, goals, weeklyReview, recentDocs] = await Promise.all([
    loadWork(userId, organizationId, now, locale).catch(() => null),
    loadInbox(userId, organizationId, now).catch(() => null),
    isGuest ? Promise.resolve(null) : loadReminders(userId, organizationId, now, locale).catch(() => null),
    isGuest ? Promise.resolve(null) : loadGoals(userId, organizationId).catch(() => null),
    isGuest ? Promise.resolve(null) : loadWeeklyReview(userId, organizationId, now, locale).catch(() => null),
    isGuest ? Promise.resolve(null) : loadRecentDocs(userId, organizationId, u.accessLevel, prefs).catch(() => null),
  ]);

  const payload: HomePayload = {
    isGuest,
    locale: { timeZone: locale.timeZone ?? null, weekStart: locale.weekStart ?? null },
    work,
    inbox,
    reminders,
    goals,
    weeklyReview,
    recentDocs,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
}

// ── My work ───────────────────────────────────────────────────────

async function loadWork(userId: string, organizationId: string, now: Date, locale: LocaleContext) {
  const endOfWeek = endOfWeekInstant(now, locale);
  // The read is narrowed to "anything that could land in one of the three
  // groups": due before the end of the viewer's week. Everything further out
  // is Later, which this widget does not show, so it is never read.
  const rows = await prisma.item.findMany({
    where: {
      organizationId,
      archivedAt: null,
      // Mine: primary assignee or one of several.
      OR: [{ ownerId: userId }, { assigneeIds: { has: userId } }],
      // Anything that could land in one of the three groups. Everything
      // further out is "Later", which this widget does not draw, so it is
      // never read.
      AND: [{ OR: [{ dueAt: { lt: endOfWeek } }, { dueAt: null, startAt: { lt: endOfWeek } }] }],
    },
    select: {
      id: true, title: true, status: true, priority: true, dueAt: true, startAt: true,
      // `statuses` travels with the row so the widget's checkbox knows which
      // word "done" is in THIS List. Without it the tick would have to guess
      // ("DONE"), and a List whose done status is "Shipped" would silently
      // write a status it does not have.
      board: { select: { id: true, slug: true, name: true, statuses: true } },
    },
    orderBy: [{ dueAt: "asc" }, { position: "asc" }],
    // Bounded, and the bound is far above the ten rows drawn: the extra rows
    // exist so the "N more" footer count is real rather than "10+".
    take: 200,
  });

  const open = rows.filter((r) => !isDoneStatusName(r.status));
  const groups: { overdue: HomeTaskRow[]; today: HomeTaskRow[]; week: HomeTaskRow[] } = { overdue: [], today: [], week: [] };
  for (const r of open) {
    const bucket = homeBucketFor(r.dueAt ?? r.startAt, now, locale);
    if (!bucket) continue;
    groups[bucket].push({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      list: r.board ? { id: r.board.id, slug: r.board.slug, name: r.board.name } : null,
      doneStatus: firstDoneStatus(r.board),
    });
  }

  const totalShown = groups.overdue.length + groups.today.length + groups.week.length;
  // Trim to the budget across the three groups, nearest first, so the ten rows
  // a person sees are the ten that matter today.
  let remaining = WORK_ROW_BUDGET;
  const trimmed = {
    overdue: take(groups.overdue, () => remaining, (n) => { remaining -= n; }),
    today: take(groups.today, () => remaining, (n) => { remaining -= n; }),
    week: take(groups.week, () => remaining, (n) => { remaining -= n; }),
  };

  return {
    ...trimmed,
    counts: {
      overdue: groups.overdue.length,
      today: groups.today.length,
      week: groups.week.length,
      shown: WORK_ROW_BUDGET - remaining,
      more: Math.max(0, totalShown - (WORK_ROW_BUDGET - remaining)),
    },
  };
}

/** The value the checkbox writes: this List's own first done status. */
function firstDoneStatus(board: { statuses?: unknown } | null): string | null {
  const options = getBoardStatuses(board);
  const done = options.find((o) => o.group === "DONE") ?? options.find((o) => isDoneStatusName(o.value));
  return done?.value ?? null;
}

function take<T>(rows: T[], budget: () => number, spend: (n: number) => void): T[] {
  const n = Math.max(0, Math.min(rows.length, budget()));
  spend(n);
  return rows.slice(0, n);
}

// ── Inbox ─────────────────────────────────────────────────────────

async function loadInbox(userId: string, organizationId: string, now: Date) {
  // "the 5 newest UNREAD Primary notifications" (spec section 2, widget 2):
  // the tab itself now also holds rows the viewer has read, which belong in
  // the Inbox list and not in a five-row summary of what is new.
  const [unread, rows] = await withClearedAtFallback(() =>
    Promise.all([
      prisma.notification.count({ where: unreadWhere(userId, now) }),
      prisma.notification.findMany({
        where: tabUnreadWhere("primary", userId, now),
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]),
  );
  void organizationId;
  return {
    unread,
    rows: rows.map((n) => {
      const kind = kindFor(n.type);
      const target = notificationTarget(n.link);
      return {
        id: n.id,
        title: n.title,
        message: n.message,
        createdAt: n.createdAt.toISOString(),
        kind: { label: kind.label, icon: kind.icon },
        href: target.href,
      };
    }),
  };
}

// ── Reminders ─────────────────────────────────────────────────────

async function loadReminders(userId: string, organizationId: string, now: Date, locale: LocaleContext) {
  void locale;
  const rows = await prisma.reminder.findMany({
    where: {
      userId,
      organizationId,
      status: { in: ["PENDING", "FIRED"] },
      // Due today or already past: a reminder for next Tuesday is not a thing
      // to do this morning.
      remindAt: { lt: new Date(now.getTime() + 86_400_000) },
    },
    orderBy: { remindAt: "asc" },
    take: 8,
    select: { id: true, title: true, remindAt: true, status: true, entityType: true, entityId: true },
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      remindAt: r.remindAt.toISOString(),
      overdue: r.remindAt < now,
      href: r.entityType === "BOARD_ITEM" && r.entityId ? `/item/${r.entityId}` : null,
    })),
  };
}

// ── My goals ──────────────────────────────────────────────────────

async function loadGoals(userId: string, organizationId: string) {
  const rows = await prisma.oKR.findMany({
    where: {
      organizationId,
      OR: [{ ownerId: userId }, { assignees: { some: { userId } } }],
      status: { not: "COMPLETED" },
    },
    orderBy: [{ endDate: "asc" }, { createdAt: "desc" }],
    take: 5,
    select: { id: true, title: true, progress: true, endDate: true, status: true },
  });
  return {
    rows: rows.map((g) => ({
      id: g.id,
      title: g.title,
      progress: typeof g.progress === "number" ? g.progress : 0,
      endDate: g.endDate ? g.endDate.toISOString() : null,
      status: g.status,
    })),
  };
}

// ── Weekly review ─────────────────────────────────────────────────

/**
 * Rendered only when the viewer actually has something to review: an active
 * KRA assignment, a KPI number waiting, or a review row that already exists.
 * `null` means "do not draw this widget", which is how the spec asks a
 * data-derived widget to disappear rather than render an empty card.
 *
 * It READS. `getOrCreateWeeklyReview` in lib/weekly-review.ts creates a DRAFT
 * row as a side effect of being asked, and a widget that silently creates a
 * review every time somebody opens Home is a widget that writes to the
 * database on a page load. The page itself still creates the row when the
 * person opens it.
 */
async function loadWeeklyReview(userId: string, organizationId: string, now: Date, locale: LocaleContext) {
  const [assignments, review, pendingKpis] = await Promise.all([
    prisma.kRAAssignment.count({ where: { userId, status: "ACTIVE" } }),
    prisma.weeklyReview.findFirst({
      where: { userId, organizationId },
      orderBy: { periodStart: "desc" },
      select: { id: true, periodStart: true, status: true },
    }).catch(() => null),
    prisma.kPIRecord.count({ where: { userId, status: "PENDING" } }).catch(() => 0),
  ]);

  if (assignments === 0 && !review && pendingKpis === 0) return null;
  void now;
  void locale;
  return {
    weekStart: review?.periodStart ? review.periodStart.toISOString() : null,
    status: review?.status ?? "NOT_STARTED",
    kpisToRecord: pendingKpis,
  };
}

// ── Recent docs ───────────────────────────────────────────────────

async function loadRecentDocs(
  userId: string,
  organizationId: string,
  accessLevel: string | null | undefined,
  prefs: Awaited<ReturnType<typeof getEffectivePreferences>> | null,
) {
  const views = Array.isArray(prefs?.home?.recentDocViews) ? prefs.home.recentDocViews : [];
  const ids: string[] = [];
  const viewedAt = new Map<string, string>();
  for (const v of views as Array<{ docId?: string; at?: string } | string>) {
    if (typeof v === "string") { ids.push(v); continue; }
    if (v && typeof v.docId === "string") {
      ids.push(v.docId);
      if (typeof v.at === "string") viewedAt.set(v.docId, v.at);
    }
  }
  if (ids.length === 0) return { rows: [] };

  const docs = await prisma.doc.findMany({
    where: { id: { in: ids.slice(0, 20) }, organizationId, archivedAt: null },
    select: { id: true, title: true, updatedAt: true, entityType: true, entityId: true },
  });
  // A doc whose anchor the viewer can no longer read is DROPPED rather than
  // rendered as a row that 404s. `docAccessible` is the same gate the Docs
  // pages use, so this list can never be wider than what /docs would show.
  const allowed = await Promise.all(
    docs.map(async (d) =>
      (await docAccessible({ entityType: d.entityType, entityId: d.entityId }, userId, accessLevel)) ? d.id : null,
    ),
  );
  const allowedIds = new Set(allowed.filter((v): v is string => v !== null));
  // Keep the preference's order (most recent first), not the query's.
  const byId = new Map(docs.map((d) => [d.id, d]));
  const rows = ids
    .map((id) => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => !!d && allowedIds.has(d.id))
    .slice(0, 8)
    .map((d) => ({
      id: d.id,
      title: d.title,
      viewedAt: viewedAt.get(d.id) ?? d.updatedAt.toISOString(),
    }));
  return { rows };
}
