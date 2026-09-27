// Scheduled email reports (gap 16): the server half.
//
// EACH RECIPIENT'S COPY IS COMPUTED UNDER THAT RECIPIENT'S OWN ACCESS, never
// the sender's. A card or a List the recipient cannot read is simply not in
// their email; a recipient who cannot read the target at all, or who is
// deactivated, deleted or no longer in the organization, is skipped, and the
// skip is recorded as a COUNT in runLog and never by name. A count can still
// name someone (a schedule with one recipient), so the counts, and whether a
// copy went out at all (lastSentAt), are shown only to an org Owner or Admin
// (schedule.ts runLogForViewer): a schedule cannot be used to learn another
// member's access.
//
// IDEMPOTENT PER (schedule, due instant). The cron computes the emails, then
// claims the run in ONE transaction: the row locked, its nextRunAt compared
// with the exact due instant it read (compare-and-swap), the recipient list
// re-read under the lock, the emails queued into the existing EmailLog queue
// (src/app/api/cron/email-queue sends them) and nextRunAt moved forward. A
// retried or concurrent cron finds nextRunAt already moved and queues nothing.
//
// Server-only: prisma.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emailLogData } from "@/lib/email";
import { absoluteUrl } from "@/lib/app-url";
import { viewerForCron } from "@/lib/access/viewer";
import { viewVisibleTo } from "@/lib/work/view-visibility";
import { readDashboard, viewerZone } from "@/lib/dashboards/dashboard-server";
import { computeWidget, redactForViewer, type WidgetReader, type WidgetResult } from "@/lib/dashboards/widget-data";
import { parseWidgets, type Widget } from "@/lib/dashboards/widgets";
import { FILTER_OPERATORS, type FilterOperatorName } from "@/lib/list-comfort";
import { boardForViewer, listReader, memberViewer, recipientRows, viewerIsOrgAdmin, type LinkViewer } from "@/lib/list-links-server";
import {
  appendRunLog,
  buildReportEmail,
  cadenceText,
  isMissingReportTableError,
  nextReportRunAt,
  parseRunLog,
  runLogForViewer,
  type ReportCadence,
  type ReportSection,
  type RunLogEntry,
  type RunLogView,
  type ScheduleSpec,
} from "./schedule";

export const PHASE5B_SQL_FILE = "prisma/sql/2026-09-24-phase5b-data.sql";

// ── Is the table there? ──────────────────────────────────────────────

const RECHECK_MS = 5 * 60 * 1000;
let availability: { value: boolean; at: number } | null = null;

export async function reportTableAvailable(): Promise<boolean> {
  if (availability?.value) return true;
  if (availability && Date.now() - availability.at < RECHECK_MS) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"ReportSchedule"')::text AS t`;
    availability = { value: !!rows[0]?.t, at: Date.now() };
  } catch {
    availability = { value: false, at: Date.now() };
  }
  return availability.value;
}

export function markReportTableMissing(): void {
  availability = { value: false, at: Date.now() };
}

export function reportsUnavailableResponse(): NextResponse {
  return NextResponse.json({ error: "needs_database_update", file: PHASE5B_SQL_FILE }, { status: 503 });
}

/** A route body, answered with the named 503 when the table is absent. */
export async function withReportTable(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  if (!(await reportTableAvailable())) return reportsUnavailableResponse();
  try {
    return await fn();
  } catch (err) {
    if (isMissingReportTableError(err)) {
      markReportTableMissing();
      return reportsUnavailableResponse();
    }
    throw err;
  }
}

export function cronInstalled(): boolean {
  return process.env.REPORT_SCHEDULE_CRON === "on";
}

export function specOf(row: { cadence: string; weekday: number | null; monthDay: number | null; timeOfDay: string; timezone: string }): ScheduleSpec {
  return { cadence: row.cadence as ReportCadence, weekday: row.weekday, monthDay: row.monthDay, timeOfDay: row.timeOfDay, timezone: row.timezone };
}

// ── Targets ──────────────────────────────────────────────────────────

export interface TargetInfo {
  name: string;
  link: string;
  /** A private view (not shared, with an owner) may only be sent to its owner. */
  privateOwnerId: string | null;
}

/**
 * The target as THIS member may read it now, or null. A dashboard answers
 * through the dashboard read gate; a view through its List (readable by
 * getBoardForReader, live, not system) AND viewVisibleTo.
 */
export async function readableTarget(kind: string, targetId: string, c: LinkViewer): Promise<TargetInfo | null> {
  if (kind === "dashboard") {
    const d = await readDashboard(targetId, c);
    return d ? { name: d.row.name, link: absoluteUrl(`/dashboards/${d.row.id}`), privateOwnerId: null } : null;
  }
  if (kind === "view") {
    const view = await prisma.view.findUnique({
      where: { id: targetId },
      include: { board: { select: { id: true, slug: true, name: true, organizationId: true, archivedAt: true, settings: true } } },
    });
    if (!view || view.board.organizationId !== c.organizationId || view.board.archivedAt) return null;
    const system = !!view.board.settings && typeof view.board.settings === "object" && (view.board.settings as Record<string, unknown>).system === true;
    if (system) return null;
    if (!(await boardForViewer(c, view.board.id)) || !viewVisibleTo(view, c.userId)) return null;
    return {
      name: `${view.board.name}: ${view.name}`,
      link: absoluteUrl(`/boards/${view.board.slug}?view=${view.id}`),
      privateOwnerId: !view.isShared && view.ownerId ? view.ownerId : null,
    };
  }
  return null;
}

/**
 * The owner of a private view, decided from the view row itself and never
 * from who is asking, or null (a shared view, a dashboard, a view that is
 * gone). An org admin who cannot read someone's private view must still be
 * held to "its owner only" when editing that view's schedule.
 */
export async function privateViewOwner(kind: string, targetId: string, organizationId: string): Promise<string | null> {
  if (kind !== "view") return null;
  const view = await prisma.view.findUnique({
    where: { id: targetId },
    select: { isShared: true, ownerId: true, board: { select: { organizationId: true } } },
  });
  if (!view || view.board.organizationId !== organizationId) return null;
  return !view.isShared && view.ownerId ? view.ownerId : null;
}

/**
 * Whether a target still exists, regardless of who reads it: live, archived
 * or in Trash (both of which only skip a run, so a restore resumes the
 * schedule), or gone for good (the only state that stops it).
 */
export async function targetState(kind: string, targetId: string, organizationId: string): Promise<"ok" | "unavailable" | "gone"> {
  if (kind === "dashboard") {
    const d = await prisma.dashboard.findFirst({ where: { id: targetId, organizationId }, select: { archivedAt: true } });
    if (!d) return "gone";
    return d.archivedAt ? "unavailable" : "ok";
  }
  if (kind === "view") {
    const v = await prisma.view.findUnique({ where: { id: targetId }, select: { board: { select: { organizationId: true, archivedAt: true } } } });
    if (v) {
      if (v.board.organizationId !== organizationId) return "gone";
      return v.board.archivedAt ? "unavailable" : "ok";
    }
    // A view whose List (or its Folder or Space) is in Trash comes back with it.
    const held = await prisma.trashItem.findFirst({
      where: { organizationId, entityType: { in: ["board", "folder", "space"] }, snapshot: { path: ["children", "views"], array_contains: [{ id: targetId }] } },
      select: { id: true },
    });
    return held ? "unavailable" : "gone";
  }
  return "gone";
}

// ── The copy one recipient receives ─────────────────────────────────

function sectionFor(w: Widget, result: WidgetResult): ReportSection | null {
  const title = "title" in w ? w.title : "Card";
  switch (result.kind) {
    case "stat":
      return { heading: title, lines: [String(Math.round(result.value * 100) / 100)] };
    case "chart":
      return { heading: title, lines: result.buckets.slice(0, 8).map((b) => `${b.label}: ${b.count}`) };
    case "list":
      return {
        heading: title,
        lines: result.rows.slice(0, 10).map((r) => `${r.title}${r.statusLabel ? ` (${r.statusLabel}${r.dueAt ? `, due ${r.dueAt.slice(0, 10)}` : ""})` : r.dueAt ? ` (due ${r.dueAt.slice(0, 10)})` : ""}`),
      };
    case "notes":
      return w.kind === "notes" && w.text.trim() ? { heading: title, lines: [w.text.trim().slice(0, 500)] } : null;
    default:
      // hidden, empty and error cards say nothing, and nothing about why.
      return null;
  }
}

/** A view's saved filter, read the way the board filter bar stores it. */
function viewFilter(config: unknown): { connector: "AND" | "OR"; rules: Array<{ field: string; operator: FilterOperatorName; value: string }>; hideDone: boolean } {
  const cfg = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const f = cfg.filters && typeof cfg.filters === "object" && !Array.isArray(cfg.filters) ? (cfg.filters as Record<string, unknown>) : {};
  const rules: Array<{ field: string; operator: FilterOperatorName; value: string }> = [];
  for (const r of Array.isArray(f.rules) ? f.rules : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.field !== "string" || !o.field) continue;
    if (typeof o.operator !== "string" || !(FILTER_OPERATORS as readonly string[]).includes(o.operator)) continue;
    rules.push({ field: o.field, operator: o.operator as FilterOperatorName, value: typeof o.value === "string" ? o.value : "" });
  }
  return { connector: f.connector === "OR" ? "OR" : "AND", rules, hideDone: f.hideDone === true };
}

export type RecipientReport =
  | { subject: string; html: string }
  | { skipped: "no_access" | "target_unavailable" };

/**
 * The email ONE recipient gets, computed under their access alone.
 * `c` must be a live member of the schedule's org (memberViewer).
 */
export async function buildRecipientReport(
  schedule: { organizationId: string; targetKind: string; targetId: string; cadence: string; weekday: number | null; monthDay: number | null; timeOfDay: string; timezone: string },
  c: LinkViewer,
  now: Date = new Date(),
): Promise<RecipientReport> {
  const state = await targetState(schedule.targetKind, schedule.targetId, schedule.organizationId);
  if (state !== "ok") return { skipped: "target_unavailable" };
  if (c.organizationId !== schedule.organizationId) return { skipped: "no_access" };
  const target = await readableTarget(schedule.targetKind, schedule.targetId, c);
  if (!target) return { skipped: "no_access" };
  if (target.privateOwnerId && target.privateOwnerId !== c.userId) return { skipped: "no_access" };
  const viewer = await viewerForCron(schedule.organizationId, c.userId, "VIEW");
  if (!viewer) return { skipped: "no_access" };
  const reader: WidgetReader = { ctx: c, viewer, zone: await viewerZone(c, schedule.timezone), now };
  const lists = listReader(c);

  let cards: Widget[];
  if (schedule.targetKind === "dashboard") {
    const d = await prisma.dashboard.findFirst({ where: { id: schedule.targetId, organizationId: schedule.organizationId }, select: { widgets: true } });
    cards = parseWidgets(d?.widgets);
  } else {
    const view = await prisma.view.findUnique({ where: { id: schedule.targetId }, select: { boardId: true, config: true } });
    if (!view) return { skipped: "target_unavailable" };
    const filter = viewFilter(view.config);
    const source = { kind: "lists" as const, listIds: [view.boardId] };
    const layout = { x: 0, y: 0, w: 4, h: 4 };
    cards = [
      { id: "open", kind: "stat", title: "Open tasks", source, filter, metric: { op: "count" }, scope: "open", layout },
      { id: "overdue", kind: "stat", title: "Overdue", source, filter, metric: { op: "count" }, scope: "overdue", layout },
      { id: "done", kind: "stat", title: "Done", source, filter, metric: { op: "count" }, scope: "completed", layout },
      { id: "next", kind: "list", title: "Next up", source, filter: { ...filter, hideDone: true }, sort: "due", limit: 10, layout },
    ];
  }
  const visible = await redactForViewer(cards, reader, lists);
  const sections: ReportSection[] = [];
  for (let i = 0; i < visible.length; i += 1) {
    const result = await computeWidget(visible[i], reader, lists);
    const card = cards[i];
    const s = card ? sectionFor(card, result) : null;
    if (s) sections.push(s);
  }
  return buildReportEmail({
    title: target.name,
    kindLabel: schedule.targetKind === "dashboard" ? "Dashboard" : "View",
    cadence: cadenceText(specOf(schedule)),
    sections,
    link: target.link,
    // Not the target's page: a recipient who lost access to it still needs a
    // way to stop receiving (the list on Settings, Notifications).
    manageLink: absoluteUrl("/settings/notifications#reports"),
  });
}

// ── DTOs ─────────────────────────────────────────────────────────────

export interface ScheduleDTO {
  id: string;
  targetKind: string;
  /** Null when this viewer cannot read the target. */
  targetId: string | null;
  targetName: string | null;
  cadence: string;
  weekday: number | null;
  monthDay: number | null;
  timeOfDay: string;
  timezone: string;
  cadenceText: string;
  recipients: Array<{ id: string; firstName: string; lastName: string; avatar: string | null; active: boolean }>;
  active: boolean;
  /** When a copy last went to anyone: org Owner or Admin only (runLogForViewer says why). */
  lastSentAt: Date | null;
  /** When the schedule last ran, for everyone who may see it. */
  lastRunAt: string | null;
  nextRunAt: Date | null;
  lastRun: RunLogView | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  canEdit: boolean;
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.reportSchedule.findFirst>>>;

export function canEditSchedule(row: Pick<Row, "createdById">, c: LinkViewer): boolean {
  return row.createdById === c.userId || viewerIsOrgAdmin(c);
}

export async function toScheduleDTOs(rows: Row[], c: LinkViewer): Promise<ScheduleDTO[]> {
  const userIds = Array.from(new Set(rows.flatMap((r) => r.recipientUserIds)));
  // The org's rows only, with the same eligibility the write and the cron
  // apply, so `active` is exactly "this person still receives it".
  const users = userIds.length ? await recipientRows(userIds, c.organizationId) : [];
  const byId = new Map(users.map((u) => [u.id, u] as const));
  const admin = viewerIsOrgAdmin(c);
  const out: ScheduleDTO[] = [];
  for (const r of rows) {
    const lastRun = runLogForViewer(parseRunLog(r.runLog).slice(0, 1), { admin })[0] ?? null;
    const target = await readableTarget(r.targetKind, r.targetId, c);
    out.push({
      id: r.id,
      targetKind: r.targetKind,
      // A target this viewer cannot read (an org admin looking at someone's
      // private view) is named by neither its words nor its id.
      targetId: target ? r.targetId : null,
      targetName: target?.name ?? null,
      cadence: r.cadence,
      weekday: r.weekday,
      monthDay: r.monthDay,
      timeOfDay: r.timeOfDay,
      timezone: r.timezone,
      cadenceText: cadenceText(specOf(r)),
      recipients: r.recipientUserIds
        .map((id) => byId.get(id))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, avatar: u.avatar, active: !u.deletedAt && u.status !== "INACTIVE" && !u.guest })),
      active: r.active,
      // Whether a copy went out is, with one recipient, whether they can read
      // the target; only an admin is told.
      lastSentAt: admin ? r.lastSentAt : null,
      lastRunAt: lastRun?.ranAt ?? null,
      nextRunAt: r.nextRunAt,
      lastRun,
      createdById: r.createdById,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      canEdit: canEditSchedule(r, c),
    });
  }
  return out;
}

// ── The cron ─────────────────────────────────────────────────────────

export interface RunTotals {
  ran: true;
  at: string;
  schedules: number;
  queued: number;
  skippedNoAccess: number;
  skippedInactive: number;
  targetUnavailable: number;
  deactivated: number;
}

/**
 * Run every due schedule, oldest first, until `limit` runs or `budgetMs`
 * passes. Safe to call twice for the same instant: see the header.
 */
export async function runDueReports(now: Date, opts: { limit: number; budgetMs: number }): Promise<RunTotals | { ran: true; skipped: "table_absent" }> {
  if (!(await reportTableAvailable())) return { ran: true, skipped: "table_absent" };
  const started = Date.now();
  const totals: RunTotals = { ran: true, at: now.toISOString(), schedules: 0, queued: 0, skippedNoAccess: 0, skippedInactive: 0, targetUnavailable: 0, deactivated: 0 };
  let due: Array<{ id: string; nextRunAt: Date | null }>;
  try {
    due = await prisma.reportSchedule.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
      take: opts.limit,
      select: { id: true, nextRunAt: true },
    });
  } catch (err) {
    if (isMissingReportTableError(err)) {
      markReportTableMissing();
      return { ran: true, skipped: "table_absent" };
    }
    throw err;
  }
  for (const d of due) {
    if (Date.now() - started > opts.budgetMs) break;
    if (!d.nextRunAt) continue;
    try {
      const entry = await runOne(d.id, d.nextRunAt, now);
      if (!entry) continue;
      totals.schedules += 1;
      totals.queued += entry.sent;
      totals.skippedNoAccess += entry.skippedNoAccess;
      totals.skippedInactive += entry.skippedInactive;
      if (entry.outcome === "target_unavailable") totals.targetUnavailable += 1;
      if (entry.outcome === "deactivated") totals.deactivated += 1;
    } catch (err) {
      // One schedule failing must not stop the others; its nextRunAt did not
      // move, so the next cron run tries it again.
      console.error(`[reports] schedule ${d.id} failed`, err);
    }
  }
  return totals;
}

async function runOne(id: string, dueAt: Date, now: Date): Promise<RunLogEntry | null> {
  const row = await prisma.reportSchedule.findFirst({ where: { id, active: true, nextRunAt: dueAt } });
  if (!row) return null;
  const state = await targetState(row.targetKind, row.targetId, row.organizationId);

  // Computed OUTSIDE the claim, per recipient, under each one's own access.
  const prepared: Array<{ userId: string; to: string; subject: string; html: string }> = [];
  let skippedNoAccess = 0;
  let skippedInactive = 0;
  if (state === "ok") {
    for (const uid of Array.from(new Set(row.recipientUserIds))) {
      // Deactivated, deleted or no longer in this org: skipped and counted.
      const member = await memberViewer(uid, row.organizationId);
      if (!member) {
        skippedInactive += 1;
        continue;
      }
      const report = await buildRecipientReport(row, member, now);
      if ("skipped" in report) {
        skippedNoAccess += 1;
        continue;
      }
      prepared.push({ userId: member.userId, to: member.email, subject: report.subject, html: report.html });
    }
  }

  // The claim: the row locked, the due instant compared, the recipients
  // re-read, the emails queued and the schedule moved on, all at once.
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ReportSchedule" WHERE id = ${id} FOR UPDATE`;
      const live = await tx.reportSchedule.findFirst({ where: { id, active: true, nextRunAt: dueAt } });
      if (!live) return null;
      // Someone who left the list since the emails were computed gets nothing
      // (and is no longer a recipient, so is not counted as a skip either).
      const still = new Set(live.recipientUserIds);
      const toSend = prepared.filter((p) => still.has(p.userId));
      if (toSend.length) {
        await tx.emailLog.createMany({
          data: toSend.map((p) =>
            emailLogData({
              to: p.to,
              subject: p.subject,
              html: p.html,
              template: "report_schedule",
              variables: { scheduleId: id, dueAt: dueAt.toISOString() },
              organizationId: live.organizationId,
            }),
          ),
        });
      }
      const next = state === "gone" ? null : nextReportRunAt(specOf(live), now);
      const deactivate = state === "gone" || next === null;
      const entry: RunLogEntry = {
        dueAt: dueAt.toISOString(),
        ranAt: now.toISOString(),
        outcome: deactivate ? "deactivated" : state === "unavailable" ? "target_unavailable" : toSend.length ? "sent" : "nothing_sent",
        sent: toSend.length,
        skippedNoAccess,
        skippedInactive,
      };
      await tx.reportSchedule.update({
        where: { id },
        data: {
          nextRunAt: deactivate ? null : next,
          active: !deactivate,
          ...(toSend.length ? { lastSentAt: now } : {}),
          runLog: appendRunLog(live.runLog, entry) as unknown as object,
        },
      });
      return entry;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
