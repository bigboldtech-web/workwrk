// GET /api/calendar/events: THE ONE CALENDAR READ.
//
// spec-planner.md section 0 row 13 folds three feeds into this endpoint, and
// section 2 `/planner` Data specifies its shape. Before it existed the Planner
// grid read `/api/planner/events` (tasks only), and `/api/calendar` and
// `/api/calendar/meetings` served nothing at all: they had zero callers in the
// product, so a meeting never appeared on the calendar and a reminder never
// did either, while two orphan routes kept answering.
//
//   ?from=ISO&to=ISO                the visible range (required in practice;
//                                   defaults to the week containing today)
//   ?calendar=my|team               whose calendar. `team` needs the
//                                   relationship; without it the answer is
//                                   `my` plus `teamDenied: true`, so the page
//                                   can print one honest notice line instead
//                                   of showing the viewer's own week while
//                                   claiming it is the team's.
//   ?people=<id,id>                 narrows a team read
//   ?kinds=task,meeting,event,external,reminder
//                                   which kinds to compute. The five words are
//                                   `home.planner.sources`, so the filter panel
//                                   turning a source off means the server stops
//                                   reading that table rather than the client
//                                   hiding rows it already paid for.
//
// Answers:
//   { events: [{ id, kind, title, start, end, allDay, status, personId, url,
//                editable, busyOnly }],
//     people: [{ id, name, avatar }],
//     loggedByPersonDay: { [personId]: { [YYYY-MM-DD]: minutes } },
//     range: { from, to }, calendar, teamDenied }
//
// DAY BUCKETING, AND THE ONE PLACE IT IS DELIBERATELY NOT ZONED. Every
// INSTANT this endpoint returns (a task's start, a meeting's time, a
// reminder) is placed on a day column by the client in the viewer's own
// zone, because a calendar day only exists in a time zone and the server's
// own zone put a Monday evening session under Tuesday for a viewer in New
// York (audit P-11, T-7, TC-4).
//
// `loggedByPersonDay` is the exception, and the reason is the column's type:
// `TimeEntry.day` is not an instant, it is a CALENDAR DAY already, stored at
// 00:00 UTC by the timesheet (src/lib/timesheet-week.ts). Converting a
// stored calendar day into another zone moves it, so it is read back as the
// day it names. See the comment at the read.
//
// `event` and `external` come out of the CalendarEvent table
// (prisma/sql/2026-09-22-calendar-event.sql): a personal block of time and a
// Google-synced row are the same shape and differ only by `externalSource`.
// The read is WRAPPED, so a deployment that has not applied that file yet
// answers "no events" rather than a 500, which is the rule every reader in
// this phase follows. The GCAL-marked Item rows the old sync wrote are still
// read alongside it and still report as `external`, so nothing a connected
// calendar produced disappears on the day the table lands and before
// scripts/backfill-calendar-events.mjs has run.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";
import { normaliseEventKind, resolveEventEnd, resolveEventTitle } from "@/lib/calendar-event";

export type CalendarEventKind = "task" | "meeting" | "event" | "external" | "reminder";

const ALL_KINDS: readonly CalendarEventKind[] = ["task", "meeting", "event", "external", "reminder"];

interface CalEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string | null;
  personId: string | null;
  url: string | null;
  editable: boolean;
  /**
   * The day column an ALL-DAY row belongs to, "YYYY-MM-DD", already decided.
   *
   * A date-only task carries a CALENDAR DAY and not an instant: the column
   * stores it at 00:00 UTC, the same way `TimeEntry.day` does. Bucketing that
   * instant in the viewer's zone moves it a day earlier for anyone west of
   * UTC, which is how a task due on the 25th rendered as a one-hour block at
   * 8pm on the 24th. So the server sends the day it NAMES and the client uses
   * it verbatim. Absent on timed rows, which are instants and are bucketed in
   * the viewer's zone as before.
   */
  dayKey?: string;
  /** A teammate's row whose title must not be sent (Team view). */
  busyOnly?: boolean;
}

/** True when `d` is exactly midnight UTC: the shape a date-only column has. */
function isUtcMidnight(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The Monday-anchored week containing `d`, in UTC, as a fallback range. */
function defaultRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
  const to = new Date(from.getTime() + 7 * 86_400_000);
  return { from, to };
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const viewerId = u.id;
  const orgId = u.organizationId;

  const url = new URL(req.url);
  const fallback = defaultRange();
  const from = parseDate(url.searchParams.get("from")) ?? fallback.from;
  const to = parseDate(url.searchParams.get("to")) ?? fallback.to;
  if (to.getTime() <= from.getTime()) {
    return NextResponse.json({ error: "to must be after from" }, { status: 400 });
  }
  // A range no wider than a quarter: the Month view asks for about 42 days and
  // an unbounded `to` is how one bookmark reads a year of rows.
  if (to.getTime() - from.getTime() > 100 * 86_400_000) {
    return NextResponse.json({ error: "range must be 100 days or less" }, { status: 400 });
  }

  // AN EMPTY `kinds` MEANS EMPTY, and that is the whole difference between a
  // filter and a decoration. `?kinds=` used to be falsy, fall through to
  // ALL_KINDS, and hand back every row: unticking all five sources in the
  // filter panel showed everything, which is the exact opposite of what was
  // asked while the toolbar said "Filter · 5". Only a parameter naming
  // nothing this release RECOGNISES falls back, so an old client asking for
  // a kind that has since been renamed still sees a calendar.
  const kindsRaw = url.searchParams.get("kinds");
  const asked = kindsRaw === null ? null : kindsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const kinds = new Set<CalendarEventKind>(
    asked === null
      ? ALL_KINDS
      : asked.filter((s): s is CalendarEventKind => (ALL_KINDS as readonly string[]).includes(s)),
  );
  if (asked !== null && asked.length > 0 && kinds.size === 0) for (const k of ALL_KINDS) kinds.add(k);

  // "Show declined Google events" (home.planner.showDeclined, default off).
  const showDeclined = url.searchParams.get("declined") === "1";

  const wantTeam = url.searchParams.get("calendar") === "team";

  // WHOSE ROWS, AND IT IS THE RELATIONSHIP THAT DECIDES, NOT A LEVEL.
  // A team read is "the people who report to me", so the report tree is both
  // the question and the answer: nothing here reads accessLevel, which is
  // what the access engine's own rule asks of new code. A viewer with no
  // reports is not a team, so `calendar=team` falls back to `my` and SAYS SO
  // (`teamDenied`), rather than rendering the viewer's own week under a Team
  // pill and lying about whose week it is.
  let personIds: string[] = [viewerId];
  let calendar: "my" | "team" = "my";
  let teamDenied = false;
  // DOES A TEAM VIEW EXIST FOR THIS PERSON AT ALL? The page needs the answer
  // before it draws its header, because access-model-spec 5.4 says a control
  // the viewer cannot use is NOT RENDERED, never rendered and then answered.
  // Guessing it from a role tier on the client put a Team pill in front of
  // every Member, who clicked it and was bounced back with a notice. It is
  // the RELATIONSHIP that decides here, exactly as it does for the read
  // itself, and it is two indexed lookups rather than the whole tree: an
  // indirect report always implies a direct one.
  let hasTeam = false;
  {
    const [direct, dotted] = await Promise.all([
      prisma.user.findFirst({ where: { managerId: viewerId, organizationId: orgId }, select: { id: true } }),
      prisma.userDottedLine.findFirst({ where: { managerId: viewerId }, select: { userId: true } }),
    ]);
    hasTeam = Boolean(direct || dotted);
  }
  if (wantTeam) {
    const tree = await getEffectiveReportTree(viewerId);
    const reports = tree.filter((id) => id !== viewerId);
    if (reports.length === 0) {
      teamDenied = true;
    } else {
      calendar = "team";
      const asked = (url.searchParams.get("people") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const allowed = new Set(tree);
      // `people` can only NARROW: the tree above already decided who is
      // readable and this is applied on top of it.
      personIds = asked.length ? asked.filter((id) => allowed.has(id)) : [...allowed];
      if (personIds.length === 0) personIds = [viewerId];
      // A capped read, so one bookmark cannot ask for a thousand people.
      personIds = personIds.slice(0, 50);
    }
  }

  const events: CalEvent[] = [];

  // WHAT WAS CUT, SAID OUT LOUD. Every source below is capped, and on a
  // calendar a missing block reads as free time, so a clipped week must never
  // look like a complete one. Each cap that is reached names its kind here and
  // the page prints one line rather than quietly showing less than the truth.
  const truncated: CalendarEventKind[] = [];
  // DE-DUPLICATION, AND WHY IT IS NOT OPTIONAL.
  // scripts/backfill-calendar-events.mjs COPIES rows into CalendarEvent and
  // deliberately leaves the sources in place, so after a production run the
  // same Google event and the same personal block exist in two tables at
  // once. Both loops below push into one array, so without this every
  // migrated row would render twice on the grid. The CalendarEvent copy
  // wins, because that is the table the product is moving to. The key is the
  // one the script writes: a Google row keeps its `externalId`, a copied
  // personal Item is marked "legacy-item:<id>".
  const itemLegacyKey = new Map<string, string>();
  const supersededByCopy = new Set<string>();
  const LEGACY_ITEM_PREFIX = "legacy-item:";
  const TAKE_ITEMS = 500;
  const TAKE_MEETINGS = 500;
  const TAKE_EVENTS = 500;
  const TAKE_REMINDERS = 200;

  // ── Tasks (and the GCAL-synced rows, which report as `external`) ──
  if (kinds.has("task") || kinds.has("external")) {
    const items = await prisma.item.findMany({
      where: {
        organizationId: orgId,
        archivedAt: null,
        // A meeting is already a `meeting` event on this calendar; its
        // hidden Item row must not appear a second time as a task
        // (src/lib/system-items.ts).
        ...NOT_SYSTEM_ITEMS,
        OR: [{ ownerId: { in: personIds } }, { assigneeIds: { hasSome: personIds } }],
        AND: [{ OR: [{ dueAt: { gte: from, lte: to } }, { startAt: { gte: from, lte: to } }] }],
      },
      select: {
        id: true, title: true, status: true, startAt: true, dueAt: true,
        ownerId: true, assigneeIds: true, metadata: true,
      },
      // `nulls: "first"` is not decoration. A task whose only date is a due
      // date has a NULL startAt, and Postgres sorts NULLS LAST under a plain
      // ascending order, so the rows the cap cut were exactly the date-only
      // ones: the population most likely to be invisible anyway. They sort
      // first now, and anything the cap does reach is reported below.
      orderBy: { startAt: { sort: "asc", nulls: "first" } },
      take: TAKE_ITEMS,
    });
    if (items.length === TAKE_ITEMS) truncated.push("task");
    for (const it of items) {
      const start = it.startAt ?? it.dueAt;
      if (!start) continue;
      // A DATE-ONLY TASK IS AN ALL-DAY ROW (spec-planner section 2, the P-1
      // fix). A task whose only date is a due date is stored at 00:00 UTC,
      // which is a calendar day, not a moment: rendering it as a timed
      // one-hour block put it at whatever wall clock that instant lands on,
      // which for every western zone is the PREVIOUS day. It belongs in the
      // all-day lane, and `dayKey` tells the grid which column without asking
      // it to re-read an instant that was never one.
      const dateOnly = !(it.startAt && it.dueAt) && isUtcMidnight(start);
      const end = dateOnly
        ? new Date(start.getTime() + 24 * 60 * 60 * 1000 - 60_000)
        : it.dueAt && it.startAt ? it.dueAt : new Date(start.getTime() + 60 * 60 * 1000);
      // Provenance the legacy-task migration preserved: a row that came from
      // Google is a different kind to the person reading the grid, even
      // though it is the same table today.
      const legacy = (it.metadata as { legacyTask?: { externalSource?: string; externalId?: string } } | null)?.legacyTask;
      const kind: CalendarEventKind = legacy?.externalSource === "GCAL" ? "external" : "task";
      if (!kinds.has(kind)) continue;
      itemLegacyKey.set(
        `item:${it.id}`,
        kind === "external" && legacy?.externalId ? `gcal:${legacy.externalId}` : `${LEGACY_ITEM_PREFIX}${it.id}`,
      );
      const personId = it.ownerId ?? (it.assigneeIds ?? []).find((id) => personIds.includes(id)) ?? null;
      events.push({
        id: `item:${it.id}`,
        kind,
        title: it.title,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: dateOnly,
        ...(dateOnly ? { dayKey: start.toISOString().slice(0, 10) } : {}),
        status: it.status,
        personId,
        url: `/item/${it.id}`,
        // A team read is read only: moving somebody else's task from a
        // calendar is not a gesture this product has.
        editable: calendar === "my" && kind === "task",
      });
    }
  }

  // ── Meetings ─────────────────────────────────────────────────────
  //
  // Scoped the way /api/meetings scopes: attendance or creation. `deletedAt`
  // is filtered so a meeting in Trash leaves the calendar with it.
  if (kinds.has("meeting")) {
    const meetings = await prisma.meeting.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        scheduledAt: { gte: from, lte: to },
        OR: [
          { attendees: { some: { userId: { in: personIds } } } },
          { createdById: { in: personIds } },
        ],
      },
      select: {
        id: true, title: true, scheduledAt: true, duration: true,
        createdById: true, attendees: { select: { userId: true } },
      },
      orderBy: { scheduledAt: "asc" },
      take: TAKE_MEETINGS,
    });
    if (meetings.length === TAKE_MEETINGS) truncated.push("meeting");
    for (const m of meetings) {
      const attendeeIds = m.attendees.map((a) => a.userId);
      const personId = personIds.find((id) => attendeeIds.includes(id) || m.createdById === id) ?? null;
      events.push({
        id: `meeting:${m.id}`,
        kind: "meeting",
        title: m.title,
        start: m.scheduledAt.toISOString(),
        end: new Date(m.scheduledAt.getTime() + (m.duration || 30) * 60_000).toISOString(),
        allDay: false,
        status: null,
        personId,
        url: `/meetings/${m.id}`,
        editable: attendeeIds.includes(viewerId) || m.createdById === viewerId,
      });
    }
  }

  // ── Personal events and the Google-synced rows ───────────────────
  //
  // One table, two kinds: `externalSource === "GCAL"` is a row the sync cron
  // brought in (kind `external`, never editable here, because editing it
  // would be overwritten by the next sync), everything else is a block the
  // person made (kind `event`).
  //
  // A teammate's row is projected as "Busy" unless their Google subscription
  // says `shareTitles`. That projection is done HERE and not in the client:
  // a title the viewer may not read is a title the server never sends.
  if (kinds.has("event") || kinds.has("external")) {
    // `hideDeclined` is a separate attempt rather than a plain filter: the
    // `declined` column arrives with prisma/sql/2026-09-22-calendar-declined.sql
    // and a deployment that has the table but not yet the column must keep
    // showing its calendar rather than losing every event. So the filtered
    // read is tried first and the unfiltered one is the fallback, which is the
    // same one-release tolerance the whole of this phase follows.
    const readRows = (hideDeclined: boolean) => prisma.calendarEvent.findMany({
      where: {
        organizationId: orgId,
        userId: { in: personIds },
        startAt: { lte: to },
        endAt: { gte: from },
        ...(hideDeclined ? { declined: false } : {}),
      },
      select: {
        id: true, userId: true, title: true, kind: true, startAt: true, endAt: true,
        allDay: true, externalSource: true, externalId: true, subscriptionId: true,
      },
      orderBy: { startAt: "asc" },
      take: TAKE_EVENTS,
    });
    try {
      let rows: Awaited<ReturnType<typeof readRows>>;
      try {
        rows = await readRows(!showDeclined);
      } catch {
        rows = await readRows(false);
      }
      if (rows.length === TAKE_EVENTS) truncated.push("event");
      // Which of the visible rows may show their title on a team calendar.
      // Read once for the whole page rather than per row.
      let shareTitleSubs = new Set<string>();
      if (calendar === "team" && rows.some((r) => r.externalSource && r.userId !== viewerId)) {
        const subs = await prisma.calendarSubscription.findMany({
          where: { userId: { in: personIds }, shareTitles: true },
          select: { id: true },
        });
        shareTitleSubs = new Set(subs.map((s) => s.id));
      }
      for (const r of rows) {
        const external = r.externalSource === "GCAL";
        const kind: CalendarEventKind = external ? "external" : "event";
        // This copy supersedes the legacy row it was made from, whether or
        // not the caller asked for that kind: the point is that the pair
        // never both render.
        if (external && r.externalId) supersededByCopy.add(`gcal:${r.externalId}`);
        else if (r.externalId?.startsWith(LEGACY_ITEM_PREFIX)) supersededByCopy.add(r.externalId);
        if (!kinds.has(kind)) continue;
        const mine = r.userId === viewerId;
        const busyOnly = !mine && (!r.subscriptionId || !shareTitleSubs.has(r.subscriptionId));
        events.push({
          id: `cal:${r.id}`,
          kind,
          title: busyOnly ? "Busy" : r.title,
          start: r.startAt.toISOString(),
          end: r.endAt.toISOString(),
          allDay: r.allDay,
          status: normaliseEventKind(r.kind),
          personId: r.userId,
          url: null,
          editable: mine && !external,
          ...(busyOnly ? { busyOnly: true } : {}),
        });
      }
    } catch {
      // The table is not there yet (the SQL file has not been applied on
      // this deployment). No events rather than a broken calendar.
    }
  }

  // ── Reminders ────────────────────────────────────────────────────
  //
  // The viewer's own PENDING reminders only, in every scope: a reminder is a
  // private note to yourself and a team calendar never shows somebody else's.
  if (kinds.has("reminder")) {
    const reminders = await prisma.reminder.findMany({
      where: {
        organizationId: orgId,
        userId: viewerId,
        status: "PENDING",
        remindAt: { gte: from, lte: to },
      },
      select: { id: true, title: true, remindAt: true, entityType: true, entityId: true },
      orderBy: { remindAt: "asc" },
      take: TAKE_REMINDERS,
    });
    if (reminders.length === TAKE_REMINDERS) truncated.push("reminder");
    for (const r of reminders) {
      events.push({
        id: `reminder:${r.id}`,
        kind: "reminder",
        title: r.title,
        start: r.remindAt.toISOString(),
        end: r.remindAt.toISOString(),
        allDay: false,
        status: null,
        personId: viewerId,
        url: r.entityType === "BOARD_ITEM" && r.entityId ? `/item/${r.entityId}` : null,
        editable: true,
      });
    }
  }

  // ── People and the logged-time footer (the People view) ──────────
  const people: Array<{ id: string; name: string; avatar: string | null }> = [];
  const loggedByPersonDay: Record<string, Record<string, number>> = {};
  if (calendar === "team") {
    const users = await prisma.user.findMany({
      where: { id: { in: personIds }, organizationId: orgId },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
    });
    for (const p of users) {
      people.push({
        id: p.id,
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email,
        avatar: p.avatar ?? null,
      });
    }
    // Time entries rather than timer sessions: the entry is what the timesheet
    // and payroll read, so the calendar footer agrees with the timesheet.
    // A missing column or table reads as no time rather than a 500 (every
    // reader in this phase tolerates that for a release).
    try {
      const entries = await prisma.timeEntry.findMany({
        where: {
          organizationId: orgId,
          userId: { in: personIds },
          day: { gte: from, lte: to },
        },
        select: { userId: true, day: true, hours: true },
        take: 5000,
      });
      for (const e of entries) {
        // `TimeEntry.day` IS ALREADY A CALENDAR DAY, stored at 00:00 UTC
        // (src/lib/timesheet-week.ts says why the timesheet anchors that
        // way). It is not an instant, so it is read back as the day it
        // names and NOT converted into the viewer's zone: doing that would
        // move every entry a day earlier for anyone west of UTC and a day
        // later for anyone far enough east, which is the same defect as
        // TC-4 with the sign reversed.
        //
        // Everything else on this calendar IS an instant and IS bucketed in
        // the viewer's zone. The difference is the column's type, not an
        // inconsistency.
        const key = e.day.toISOString().slice(0, 10);
        const perPerson = (loggedByPersonDay[e.userId] ??= {});
        perPerson[key] = (perPerson[key] ?? 0) + Math.round(Number(e.hours ?? 0) * 60);
      }
    } catch {
      // Left empty on purpose: the footer is a convenience, not the grid.
    }
  }

  // The de-duplication pass. A legacy row whose CalendarEvent copy is in
  // this same response loses; nothing is dropped when no copy exists, so a
  // workspace that has not run the backfill is exactly as it was.
  const deduped = supersededByCopy.size
    ? events.filter((e) => {
        const key = itemLegacyKey.get(e.id);
        return !(key && supersededByCopy.has(key));
      })
    : events;

  deduped.sort((a, b) => a.start.localeCompare(b.start));

  return NextResponse.json({
    events: deduped,
    people,
    loggedByPersonDay,
    calendar,
    teamDenied,
    /** True when somebody reports to the viewer: the Team pill's condition. */
    hasTeam,
    /** The kinds whose cap was reached, so the page can say the week is clipped. */
    truncated,
    range: { from: from.toISOString(), to: to.toISOString() },
  });
}

/**
 * POST /api/calendar/events - create one personal calendar entry.
 *
 * `{ title, kind: "EVENT"|"FOCUS"|"OOO", startAt, endAt, allDay, description }`
 *
 * OWNER ONLY, ALWAYS. The row is written for the caller and for nobody
 * else: there is no `userId` in the body and adding one would be the whole
 * access question for this table. A manager who wants time on a teammate's
 * calendar books a meeting, which has attendees and a gate.
 *
 * The three shape rules (an all-day row ends at the end of its own day, a
 * backwards range becomes 30 minutes rather than a rejection that loses what
 * was typed, an empty title becomes the kind's own name) live in
 * src/lib/calendar-event.ts so the PATCH beside this one cannot disagree
 * with them.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send a JSON body" }, { status: 400 });
  }

  const startAt = parseDate(typeof body.startAt === "string" ? body.startAt : null);
  if (!startAt) return NextResponse.json({ error: "startAt must be a date" }, { status: 400 });
  const endAt = parseDate(typeof body.endAt === "string" ? body.endAt : null);
  const allDay = body.allDay === true;
  const kind = normaliseEventKind(body.kind);
  const title = resolveEventTitle(body.title, kind);
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, 5000)
      : null;

  try {
    const event = await prisma.calendarEvent.create({
      data: {
        organizationId: u.organizationId,
        userId: u.id,
        title,
        kind,
        startAt,
        endAt: resolveEventEnd(startAt, endAt, allDay),
        allDay,
        description,
      },
      select: { id: true, title: true, kind: true, startAt: true, endAt: true, allDay: true, description: true },
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    // THE HONEST SENTENCE ONLY WHEN IT IS TRUE. This catch used to swallow
    // every failure into "Ask an admin to finish the calendar setup", so a
    // constraint violation or a dropped connection sent somebody to an admin
    // for a problem no admin can fix. The missing-relation codes are the
    // ones that sentence was written for (P2021 table, P2022 column);
    // anything else says what it is: the write did not land, try again.
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") {
      return NextResponse.json(
        { error: "Events are not set up on this workspace yet. Ask an admin to finish the calendar setup." },
        { status: 503 },
      );
    }
    console.error("[Calendar] Create failed:", err);
    return NextResponse.json({ error: "The event could not be saved. Try again." }, { status: 500 });
  }
}
