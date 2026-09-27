// The legacy Marketing import: Campaign, ContentItem and EventBrief rows
// become tasks on the three Lists of a "Marketing" Space built from the
// seeded template (spec-tools-misc section 2.7 "where the work goes").
//
// It is a library, not a page: scripts/migrate-marketing.ts runs it per
// organization from the command line, and the Settings > Data > Import row
// mounts it through POST /api/marketing/legacy. Both go through this one
// function so the report the founder reads and the report the Owner reads
// are the same report.
//
// RULES (scripts/MIGRATIONS.md):
//   - dry run by default: `write: false` reads everything and writes nothing;
//   - idempotent: the Space is found by its marker, the Lists by theirs, and a
//     row that any task carries the marker of, live or in Trash, is skipped
//     (legacy-map.ts "Moved or not"), so a second run moves only what the
//     first did not and a task someone trashed never comes back as a copy;
//   - the source tables are never deleted or emptied; every row keeps its id,
//     gains `migratedItemId`, and the task keeps the row's id under
//     `metadata.legacyMarketing`, so the link holds in both directions;
//   - a picked day is anchored, not copied: the legacy API stored a date as
//     UTC midnight, a task shows an instant in the viewer's zone, so every
//     UTC-midnight value becomes midnight of that day in the import zone
//     (resolveImportZone) and a task an earlier run wrote verbatim is put
//     right on the next write, as long as nobody has edited that date since;
//   - it goes through the product's own creators (createSpace,
//     applyListTemplate, createBoardItem), so the Space has its owner row,
//     the Lists have their views and statuses, and every task has its
//     activity entry, exactly as if a person had made them.
//
// NOT ONE TRANSACTION. The product's creators take the shared client, not a
// transaction client, so a failure part-way leaves a Space with some tasks
// written; the next run picks up where it stopped, because every written row
// is marked before the next one starts. The one window that leaves (a task
// created and the process gone before its row was marked) is closed by the
// task-side scan: a task on the marker Lists whose provenance names a row is
// that row's task, and the next run writes the missing mark back instead of
// creating a second task. The read-back at the end asserts that every row
// now points at a task that exists.
//
// ONE WRITE AT A TIME PER ORGANIZATION. A write takes a per-org advisory lock
// (pg_try_advisory_xact_lock on a transaction held open for the run) before
// it reads anything, so two Owners pressing Import together, or the script
// overlapping a click, cannot both build a Marketing Space: the second run
// is told an import is already running and writes nothing.
//
// A MARKER SPACE IN ANY STATE IS THE MARKER. An archived Marketing Space (or
// List) still counts as migrated: the import never builds a second one, the
// resolver still sends old links to it, and the page says it is in Trash.

import { prisma } from "@/lib/prisma";
import { createSpace } from "@/lib/space";
import { applyListTemplate, type ListTemplatePayload, type SpaceTemplatePayload } from "@/lib/template-center";
import { createBoardItem } from "@/lib/board-items";
import { orgCurrencyFromSettings } from "@/lib/org/org-currency";
import { getEffectivePreferences } from "@/lib/preferences";
import type { Prisma } from "@/generated/prisma";
import {
  campaignToTask,
  contentToTask,
  eventToTask,
  ITEM_PROVENANCE_KEY,
  LEGACY_SOURCE,
  legacyDateCorrection,
  legacyRowState,
  legacyTaskIndex,
  LIST_MARKER_KEY,
  LIST_NAME,
  MARKETING_KINDS,
  MARKETING_TEMPLATE_KEY,
  MIGRATED_ITEM_KEY,
  migratedItemId,
  SPACE_MARKER_KEY,
  TEMPLATE_NOT_READY,
  marketingTemplateProblem,
  taskProvenance,
  tasksInTrashSnapshot,
  type HeldDates,
  type LegacyDates,
  type LegacyTaskIndex,
  type MappedTask,
  type MarkedTask,
  type MarketingKind,
  type MigratedMarketing,
} from "./legacy-map";

export interface LegacyMarketingCounts {
  campaigns: number;
  content: number;
  events: number;
}

/** How many legacy rows an organization holds. Zero everywhere means the import row does not render. */
export async function countLegacyMarketing(organizationId: string): Promise<LegacyMarketingCounts> {
  const [campaigns, content, events] = await Promise.all([
    prisma.campaign.count({ where: { organizationId } }),
    prisma.contentItem.count({ where: { organizationId } }),
    prisma.eventBrief.count({ where: { organizationId } }),
  ]);
  return { campaigns, content, events };
}

export function hasLegacyMarketing(c: LegacyMarketingCounts): boolean {
  return c.campaigns + c.content + c.events > 0;
}

/** A zone name Intl knows, or null: a stored preference can hold anything. */
function validZone(zone: unknown): string | null {
  if (typeof zone !== "string" || !zone.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone.trim() });
    return zone.trim();
  } catch {
    return null;
  }
}

/**
 * The zone a picked day is anchored in (legacy-map.ts "Dates"): the actor's
 * saved locale zone (what their own task dates are written in), else the
 * workspace's work-schedule zone, else its headquarters office, else the
 * machine this runs on. It never comes back empty, so the anchoring always
 * happens and the report can name the zone it used.
 */
export async function resolveImportZone(organizationId: string, actorId: string): Promise<string> {
  const prefs = await getEffectivePreferences(actorId, organizationId).catch(() => null);
  const own = validZone(prefs?.home?.locale?.timezone);
  if (own) return own;
  const schedule = await prisma.workSchedule.findUnique({ where: { organizationId }, select: { timezone: true } }).catch(() => null);
  const org = validZone(schedule?.timezone);
  if (org) return org;
  const office = await prisma.office
    .findFirst({ where: { organizationId, timezone: { not: null } }, select: { timezone: true }, orderBy: [{ isHeadquarters: "desc" }, { createdAt: "asc" }] })
    .catch(() => null);
  const hq = validZone(office?.timezone);
  if (hq) return hq;
  return validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
}

export interface LegacyPending {
  /**
   * Rows a write still has to do something for, per kind: no task at all
   * (never moved, or the task was deleted for good from Trash), or a live
   * task whose row lost its mark in the crash window (the write re-links it).
   */
  toWrite: LegacyMarketingCounts;
  /** Rows whose task is in Trash, per kind: moved, never imported again, back when the task is restored. */
  trashed: LegacyMarketingCounts;
  /** Moved tasks still holding a date exactly as the legacy row stored it, which the next write anchors in `zone`. */
  toRedate: number;
  zone: string;
}

/**
 * What a write would still do, for the Settings > Data row: it decides
 * whether Preview and Import render once the Space exists. The same rule as
 * the import (legacy-map.ts legacyRowState), read from the same index, so
 * the page never offers to import a row the import would skip. `found` is
 * the caller's findMigratedMarketing answer, looked up here when not given.
 */
export async function pendingLegacyMarketing(organizationId: string, zone: string, found?: FoundMarketing | null): Promise<LegacyPending> {
  const rows = await loadLegacyRows(organizationId);
  const marketing = found === undefined ? await findMigratedMarketing(organizationId) : found;
  const { held, index } = await loadMovedState(organizationId, rows, marketing);
  const toWrite: LegacyMarketingCounts = { campaigns: 0, content: 0, events: 0 };
  const trashed: LegacyMarketingCounts = { campaigns: 0, content: 0, events: 0 };
  let toRedate = 0;
  for (const kind of MARKETING_KINDS) {
    for (const row of rows[kind]) {
      const at = legacyRowState(kind, row, index);
      if (at.state === "trashed") trashed[kind] += 1;
      else if (at.state === "none" || !at.marked) toWrite[kind] += 1;
      else if (legacyDateCorrection(kind, row, zone, held.get(at.itemId)!)) toRedate += 1;
    }
  }
  return { toWrite, trashed, toRedate, zone };
}

/** Every legacy row, oldest first so positions follow creation order. */
async function loadLegacyRows(organizationId: string) {
  const [campaigns, content, events] = await Promise.all([
    prisma.campaign.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
    prisma.contentItem.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
    prisma.eventBrief.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
  ]);
  return { campaigns, content, events };
}

/** An Item row as the rule reads it: its provenance, and whether it is archived (in Trash > Archived). */
function markedFromItem(i: { id: string; metadata: unknown; archivedAt: Date | null }): MarkedTask {
  const { kind, rowId } = taskProvenance(i.metadata);
  return { id: i.id, kind, rowId, archived: i.archivedAt !== null };
}

/**
 * The tasks the rows' marks name, confirmed against the Item table (an
 * archived task is still on it), with the dates they hold today and the zone
 * their provenance says those dates were anchored in.
 */
async function loadClaimedItems(organizationId: string, claimed: readonly string[]): Promise<{ held: Map<string, HeldDates>; tasks: MarkedTask[] }> {
  if (!claimed.length) return { held: new Map(), tasks: [] };
  const found = await prisma.item.findMany({
    where: { organizationId, id: { in: [...claimed] } },
    select: { id: true, startAt: true, dueAt: true, metadata: true, archivedAt: true },
  });
  return {
    held: new Map(found.map((i) => [i.id, { startAt: i.startAt, dueAt: i.dueAt, dateZone: taskProvenance(i.metadata).dateZone }])),
    tasks: found.map(markedFromItem),
  };
}

/** The tasks the marker Lists hold, with the row their provenance names: what the crash-window re-link reads. */
async function loadMarkerListTasks(organizationId: string, found: FoundMarketing | null): Promise<MarkedTask[]> {
  const listIds = found ? MARKETING_KINDS.map((k) => found.listIds[k]).filter((id): id is string => Boolean(id)) : [];
  if (!listIds.length) return [];
  const held = await prisma.item.findMany({ where: { organizationId, boardId: { in: listIds } }, select: { id: true, metadata: true, archivedAt: true } });
  return held.map(markedFromItem);
}

/**
 * The org's tasks in Trash that carry a Marketing marker: an id a row names
 * in `claimed`, or a provenance naming a row. A trashed task is no longer on
 * the Item table; it is inside a TrashItem snapshot, on its own or in the
 * snapshot of the List, Folder or Space it was trashed with.
 *
 * The SQL only narrows which snapshots come back: a task trashed on its own
 * under an id a row names, or any hierarchy snapshot whose text holds the
 * provenance key, so an org's other trashed Lists are never shipped here.
 * tasksInTrashSnapshot reads the tasks out of what comes back, and that is
 * the answer. The ids go as ONE array parameter (`= ANY`), never a
 * Prisma.join list, for the reason doc-lock.ts readDocLocks gives.
 */
export async function loadTrashedMarketingTasks(organizationId: string, claimed: readonly string[]): Promise<MarkedTask[]> {
  const snapshots = await prisma.$queryRaw<Array<{ entityType: string; snapshot: unknown }>>`
    SELECT "entityType", snapshot FROM "TrashItem"
    WHERE "organizationId" = ${organizationId}
      AND "entityType" IN ('item', 'board', 'folder', 'space')
      AND ("entityId" = ANY(${[...claimed]}::text[]) OR snapshot::text LIKE ${`%"${ITEM_PROVENANCE_KEY}"%`})`;
  const wanted = new Set(claimed);
  return snapshots.flatMap((s) => tasksInTrashSnapshot(s.entityType, s.snapshot)).filter((t) => (t.kind && t.rowId) || wanted.has(t.id));
}

/**
 * Everything the moved-or-not rule reads for one org's rows, in one place so
 * the import and the page's pending counts agree: the tasks the marks name
 * (with their dates, for the correction), the tasks on the marker Lists, and
 * the tasks in Trash snapshots.
 */
async function loadMovedState(
  organizationId: string,
  rows: Record<MarketingKind, Array<{ customFields: unknown }>>,
  found: FoundMarketing | null,
): Promise<{ held: Map<string, HeldDates>; index: LegacyTaskIndex }> {
  const claimed = MARKETING_KINDS.flatMap((k) => rows[k].map((r) => migratedItemId(r.customFields))).filter((id): id is string => Boolean(id));
  const [claimedItems, onLists, trashed] = await Promise.all([
    loadClaimedItems(organizationId, claimed),
    loadMarkerListTasks(organizationId, found),
    loadTrashedMarketingTasks(organizationId, claimed),
  ]);
  return { held: claimedItems.held, index: legacyTaskIndex({ live: [...claimedItems.tasks, ...onLists], trashed }) };
}

/**
 * The migrated Space and its three Lists, by their markers. Null until the
 * import has run. One query for the Space and one for its Lists; the resolver
 * calls it once per request.
 */
export interface FoundMarketing extends MigratedMarketing {
  spaceId: string;
  listIds: Partial<Record<MarketingKind, string>>;
  /** The Space sits in Trash (soft-archived). Old links still resolve to it; the import never builds another. */
  archived: boolean;
}

export async function findMigratedMarketing(organizationId: string): Promise<FoundMarketing | null> {
  // A live marker Space wins over an archived one; among equals, the oldest.
  const space = await prisma.space.findFirst({
    where: { organizationId, settings: { path: [SPACE_MARKER_KEY], equals: LEGACY_SOURCE } },
    select: { id: true, slug: true, archivedAt: true },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
  if (!space) return null;
  // Archived Lists count too: a List in Trash is still the List its tasks
  // live on, and creating a second "Campaigns" beside it would strand them.
  const boards = await prisma.board.findMany({
    where: { organizationId, spaceId: space.id },
    select: { id: true, slug: true, settings: true, archivedAt: true },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
  const lists: Partial<Record<MarketingKind, string>> = {};
  const listIds: Partial<Record<MarketingKind, string>> = {};
  for (const b of boards) {
    const kind = (b.settings as Record<string, unknown> | null)?.[LIST_MARKER_KEY];
    if (typeof kind === "string" && (MARKETING_KINDS as readonly string[]).includes(kind) && !lists[kind as MarketingKind]) {
      lists[kind as MarketingKind] = b.slug;
      listIds[kind as MarketingKind] = b.id;
    }
  }
  return { spaceId: space.id, spaceSlug: space.slug, lists, listIds, archived: space.archivedAt !== null };
}

/**
 * The task a legacy campaign became, for /marketing/{id}. `exists` is false
 * when no campaign has that id (a misspelled URL, which 404s like any other);
 * `itemId` is null for a campaign that exists but was never moved, and also
 * when its task sits in Trash, which `trashed` says, so the resolver lands
 * on the List with a notice rather than inside a trashed task.
 */
export async function migratedCampaignItem(organizationId: string, campaignId: string): Promise<{ exists: boolean; itemId: string | null; trashed: boolean }> {
  const row = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { customFields: true },
  });
  if (!row) return { exists: false, itemId: null, trashed: false };
  const id = migratedItemId(row.customFields);
  const item = id ? await prisma.item.findFirst({ where: { id, organizationId }, select: { id: true, archivedAt: true } }) : null;
  if (item?.archivedAt) return { exists: true, itemId: null, trashed: true };
  if (item) return { exists: true, itemId: item.id, trashed: false };
  // No live task: one in Trash still means moved (legacy-map.ts "Moved or
  // not"), and the notice must say Trash, not "not moved yet", or it sends an
  // Owner to Settings > Data to import a campaign that already has a task.
  const inTrash = await loadTrashedMarketingTasks(organizationId, id ? [id] : []);
  const trashed = inTrash.some((t) => t.id === id || (t.kind === "campaigns" && t.rowId === campaignId));
  return { exists: true, itemId: null, trashed };
}

/**
 * The template the Space is built from, or the reason it cannot be. The
 * import refuses anything but the three Lists by name, each with its own
 * statuses and fields: an older seed (two Lists, no fields) would build
 * Content and Events from the Campaigns payload, with statuses no List has
 * and values on no column, and a run marks every row, so there is no second
 * chance. Both readings are kept: `detail` for the founder's log, `blocked`
 * for the Owner's screen.
 */
export async function loadMarketingTemplate(): Promise<{ payload: SpaceTemplatePayload } | { blocked: string; detail: string }> {
  const template = await prisma.template.findFirst({ where: { key: MARKETING_TEMPLATE_KEY, builtIn: true, organizationId: null }, select: { payload: true } });
  const payload = (template?.payload ?? null) as SpaceTemplatePayload | null;
  const detail = marketingTemplateProblem(payload);
  if (detail) return { blocked: TEMPLATE_NOT_READY, detail };
  return { payload: payload! };
}

/** The lock key every write of one org's import takes (hashtext of this string). */
export function importLockKey(organizationId: string): string {
  return `legacy-marketing-import:${organizationId}`;
}

// ── The import ──────────────────────────────────────────────────────

export interface KindReport {
  read: number;
  alreadyMigrated: number;
  /** Dry run: what would be written. Write: what was written so far (exact even when the run stopped part-way). */
  written: number;
  /**
   * Rows whose task already existed on the List (the process stopped after
   * creating it and before marking the row): the mark is written back, no
   * second task is made.
   */
  relinked: number;
  /**
   * Rows whose task is in Trash: moved, then put there. No task is written
   * for them (a row with no mark gets its mark back), and restoring the task
   * is what brings it back.
   */
  trashed: number;
  /** Rows whose status moved to a neighbour (APPROVED to PLANNING, and so on). */
  statusMoved: number;
  unmappedStatuses: Array<{ value: string; count: number }>;
  /** Legacy columns folded into the description, with how many rows carried each. */
  unmappedFields: Array<{ field: string; count: number }>;
  /** Rows whose owner is no longer a live member; the task is written unassigned. */
  ownerDropped: number;
  /** Campaigns carrying a currency other than the List's. */
  currencyMismatch: number;
  /** Tasks an earlier run wrote with verbatim dates, whose untouched dates this run anchors (dry run: would anchor). */
  redated: number;
  listSlug: string | null;
  listCreated: boolean;
}

export interface LegacyMarketingReport {
  organizationId: string;
  organizationName: string;
  write: boolean;
  currency: string;
  /** The IANA zone picked days were anchored in (resolveImportZone). Absent only on a report the script builds for an org it could not run. */
  dateZone?: string;
  templateFound: boolean;
  spaceSlug: string | null;
  spaceCreated: boolean;
  kinds: Record<MarketingKind, KindReport>;
  /** Set when the org could not be migrated at all, in words for the person on the page. */
  blocked?: string;
  /** The technical reason behind `blocked`, for the script's log. */
  blockedDetail?: string;
  /** Which kind of block, so the API can pick its status: `template` is a 503 (the server is not ready), the rest are 409 (the workspace's state says no). */
  blockedCode?: "org" | "template" | "actor" | "running" | "archived";
  /** The Space (or a List) sits in Trash: old links still resolve, nothing more is built. */
  archived?: boolean;
  /** Set when the write stopped part-way; the next run resumes. */
  error?: string;
  /** After a write: every source row points at a task that exists, live or in Trash. */
  verified?: boolean;
}

export function emptyKind(): KindReport {
  return { read: 0, alreadyMigrated: 0, written: 0, relinked: 0, trashed: 0, statusMoved: 0, unmappedStatuses: [], unmappedFields: [], ownerDropped: 0, currencyMismatch: 0, redated: 0, listSlug: null, listCreated: false };
}

function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sorted<K extends string>(map: Map<string, number>, name: K): Array<Record<K, string> & { count: number }> {
  return Array.from(map, ([k, count]) => ({ [name]: k, count }) as Record<K, string> & { count: number }).sort((a, b) => b.count - a.count);
}

interface Plan<Row> {
  row: Row;
  task: MappedTask;
}

/**
 * Move one organization's legacy Marketing rows. `actorId` owns the Space and
 * is the actor on every task's activity line; the script picks the org's
 * first Owner, the API passes the signed-in Owner or Admin.
 *
 * A write runs inside a transaction that holds the per-org advisory lock for
 * the whole run (the reads and writes themselves go through the product's
 * creators on the shared client; the transaction only holds the lock), so
 * two writes for one org never overlap. A dry run takes no lock.
 */
export async function importLegacyMarketing(input: {
  organizationId: string;
  actorId: string;
  write: boolean;
}): Promise<LegacyMarketingReport> {
  const { organizationId, actorId, write } = input;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, settings: true } });
  const currency = orgCurrencyFromSettings(org?.settings);
  const zone = await resolveImportZone(organizationId, actorId);
  const report: LegacyMarketingReport = {
    organizationId,
    organizationName: org?.name ?? organizationId,
    write,
    currency,
    dateZone: zone,
    templateFound: false,
    spaceSlug: null,
    spaceCreated: false,
    kinds: { campaigns: emptyKind(), content: emptyKind(), events: emptyKind() },
  };
  if (!org) {
    report.blocked = "This workspace no longer exists.";
    report.blockedDetail = "organization not found";
    report.blockedCode = "org";
    return report;
  }
  if (!write) {
    await runImport(report, { organizationId, actorId, currency, zone, write: false });
    return report;
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        // The try variant answers at once with a boolean instead of waiting,
        // so a second run is told, not queued behind the first.
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${importLockKey(organizationId)})) AS locked`;
        if (!rows[0]?.locked) {
          report.blocked = "An import is already running for this workspace. Give it a minute, then refresh the page.";
          report.blockedDetail = "another write holds the per-org import lock";
          report.blockedCode = "running";
          return;
        }
        await runImport(report, { organizationId, actorId, currency, zone, write: true });
      },
      // The lock lives as long as the transaction: long enough for a big org.
      { maxWait: 15_000, timeout: 30 * 60_000 },
    );
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    report.verified = false;
  }
  return report;
}

async function runImport(
  report: LegacyMarketingReport,
  ctx: { organizationId: string; actorId: string; currency: string; zone: string; write: boolean },
): Promise<void> {
  const { organizationId, actorId, currency, zone, write } = ctx;

  const template = await loadMarketingTemplate();
  report.templateFound = "payload" in template;
  if (!("payload" in template)) {
    report.blocked = template.blocked;
    report.blockedDetail = template.detail;
    report.blockedCode = "template";
    return;
  }
  const payload = template.payload;

  const actor = await prisma.user.findFirst({ where: { id: actorId, organizationId, deletedAt: null }, select: { id: true } });
  if (!actor) {
    report.blocked = "Only a live member of this workspace can run the import.";
    report.blockedDetail = "the actor is not a live member of this organization";
    report.blockedCode = "actor";
    return;
  }

  const { campaigns, content, events } = await loadLegacyRows(organizationId);
  report.kinds.campaigns.read = campaigns.length;
  report.kinds.content.read = content.length;
  report.kinds.events.read = events.length;

  // The destination, by marker, in any state.
  const found = await findMigratedMarketing(organizationId);
  report.spaceSlug = found?.spaceSlug ?? null;
  report.spaceCreated = !found;
  report.archived = found?.archived ?? false;
  for (const kind of MARKETING_KINDS) {
    report.kinds[kind].listSlug = found?.lists[kind] ?? null;
    report.kinds[kind].listCreated = !found?.lists[kind];
  }
  if (campaigns.length + content.length + events.length === 0) return;

  // Which rows an earlier run already moved (legacy-map.ts "Moved or not"):
  // the live tasks the marks name, with the dates each holds today for the
  // correction below; the tasks on the marker Lists, so the crash window
  // (task created, row not yet marked) resolves to a re-link instead of a
  // duplicate; and the tasks in Trash, which are moved too.
  const { held: existingItems, index } = await loadMovedState(organizationId, { campaigns, content, events }, found);

  const members = new Set((await prisma.user.findMany({ where: { organizationId, deletedAt: null }, select: { id: true } })).map((u) => u.id));
  const campaignTitleById = new Map(campaigns.map((c) => [c.id, c.name]));

  const plans: Record<MarketingKind, Plan<{ id: string; customFields: unknown }>[]> = { campaigns: [], content: [], events: [] };
  const relinks: Record<MarketingKind, Array<{ row: { id: string; customFields: unknown }; itemId: string }>> = { campaigns: [], content: [], events: [] };
  // Tasks an earlier run wrote before dates were anchored (legacy-map.ts
  // "Dates"): the ones whose dates still read exactly as the legacy row
  // stored them are put on the same calendar day in the import zone. A date
  // someone has since set by hand is theirs and is left alone.
  const redates: Record<MarketingKind, Array<{ itemId: string; patch: Partial<LegacyDates> }>> = { campaigns: [], content: [], events: [] };
  const unmappedStatus: Record<MarketingKind, Map<string, number>> = { campaigns: new Map(), content: new Map(), events: new Map() };
  const unmappedField: Record<MarketingKind, Map<string, number>> = { campaigns: new Map(), content: new Map(), events: new Map() };

  const consider = <Row extends { id: string; customFields: unknown; status: string; startDate?: Date | null; endDate?: Date | null; scheduledFor?: Date | null }>(kind: MarketingKind, row: Row, task: MappedTask) => {
    const k = report.kinds[kind];
    const at = legacyRowState(kind, row, index);
    if (at.state === "live" && at.marked) {
      k.alreadyMigrated += 1;
      const patch = legacyDateCorrection(kind, row, zone, existingItems.get(at.itemId)!);
      if (patch) {
        k.redated += 1;
        redates[kind].push({ itemId: at.itemId, patch });
      }
      return;
    }
    if (at.state === "live") {
      k.relinked += 1;
      relinks[kind].push({ row, itemId: at.itemId });
      return;
    }
    if (at.state === "trashed") {
      // Moved, then put in Trash: never a second task. A row that lost its
      // mark gets it back, naming the id the task is restored under, so the
      // read-back holds and /marketing/{id} can say where the task went.
      k.trashed += 1;
      if (!at.marked) relinks[kind].push({ row, itemId: at.itemId });
      return;
    }
    if (task.statusUnmapped) tally(unmappedStatus[kind], row.status);
    else if (!task.statusExact) k.statusMoved += 1;
    for (const f of task.folded) tally(unmappedField[kind], f);
    if (task.currencyMismatch) k.currencyMismatch += 1;
    if (task.ownerId && !members.has(task.ownerId)) {
      k.ownerDropped += 1;
      task.ownerId = null;
    }
    plans[kind].push({ row, task });
  };
  for (const c of campaigns) consider("campaigns", c, campaignToTask(c, { listCurrency: currency, importZone: zone }));
  for (const c of content) consider("content", c, contentToTask(c, { campaignTitleById, importZone: zone }));
  for (const e of events) consider("events", e, eventToTask(e, { listCurrency: currency, campaignTitleById, importZone: zone }));
  for (const kind of MARKETING_KINDS) {
    report.kinds[kind].unmappedStatuses = sorted(unmappedStatus[kind], "value");
    report.kinds[kind].unmappedFields = sorted(unmappedField[kind], "field");
    report.kinds[kind].written = plans[kind].length;
  }

  const pending = MARKETING_KINDS.reduce((n, k) => n + plans[k].length + relinks[k].length + redates[k].length, 0);

  // A Marketing Space in Trash is still the Marketing Space: nothing is
  // built beside it, whatever is pending. Restoring it is the way back.
  if (found?.archived) {
    report.blocked = pending
      ? "The Marketing Space is in Trash. Restore it from Trash first, then run the import again to bring over what is new."
      : "The Marketing Space is in Trash. Restore it from Trash to bring the old links back; there is nothing new to import.";
    report.blockedDetail = `the marker Space "${found.spaceSlug}" is archived; ${pending} row(s) pending`;
    report.blockedCode = "archived";
    return;
  }

  if (!write) return;
  if (pending === 0 && found && MARKETING_KINDS.every((k) => found.lists[k])) return;
  for (const kind of MARKETING_KINDS) {
    report.kinds[kind].written = 0;
    report.kinds[kind].redated = 0;
  }

  try {
    // 1. The Space, once.
    let spaceId = found?.spaceId ?? null;
    if (!spaceId) {
      const space = await createSpace({
        organizationId,
        userId: actorId,
        name: "Marketing",
        icon: payload.icon,
        color: payload.color,
        // The legacy pages answered to any signed-in employee, so the Space
        // is visible to the whole organization (every Member can read it).
        // Writing needs Space membership, which the Owner grants afterwards;
        // the page and the report both say so.
        visibility: "ORG",
        settings: {
          ...(payload.workflow ? { workflow: payload.workflow } : {}),
          [SPACE_MARKER_KEY]: LEGACY_SOURCE,
        },
      });
      spaceId = space.id;
      report.spaceSlug = space.slug;
    }

    // 2. The three Lists, each once, from the template's own List payloads
    //    (validated by name above) with the MONEY fields bound to the org
    //    currency.
    const listIds: Partial<Record<MarketingKind, string>> = { ...(found?.listIds ?? {}) };
    for (const kind of MARKETING_KINDS) {
      if (listIds[kind]) continue;
      const fromTemplate = payload.lists!.find((l) => l.name === LIST_NAME[kind])!;
      const listPayload: ListTemplatePayload = {
        ...fromTemplate,
        fields: (fromTemplate.fields ?? []).map((f) => (f.type === "MONEY" ? { ...f, options: { ...(f.options ?? {}), currency } } : f)),
      };
      const created = await applyListTemplate(listPayload, { organizationId, userId: actorId, spaceId, name: LIST_NAME[kind] });
      // The marker, merged into the settings createBoard wrote.
      const current = await prisma.board.findUnique({ where: { id: created.boardId }, select: { settings: true } });
      await prisma.board.update({
        where: { id: created.boardId },
        data: { settings: { ...((current?.settings as Record<string, unknown> | null) ?? {}), [LIST_MARKER_KEY]: kind } as Prisma.InputJsonValue },
      });
      listIds[kind] = created.boardId;
      report.kinds[kind].listSlug = created.slug;
    }

    // 3. One task per row, the row marked as soon as its task exists; the
    //    count on the report moves with every row, so a run that stops
    //    part-way reports exactly what it wrote.
    const merge = (customFields: unknown, itemId: string): Prisma.InputJsonValue =>
      ({ ...((customFields as Record<string, unknown> | null) ?? {}), [MIGRATED_ITEM_KEY]: itemId }) as Prisma.InputJsonValue;
    const markers: Record<MarketingKind, (id: string, customFields: unknown, itemId: string) => Promise<void>> = {
      campaigns: async (id, cf, itemId) => { await prisma.campaign.update({ where: { id }, data: { customFields: merge(cf, itemId) } }); },
      content: async (id, cf, itemId) => { await prisma.contentItem.update({ where: { id }, data: { customFields: merge(cf, itemId) } }); },
      events: async (id, cf, itemId) => { await prisma.eventBrief.update({ where: { id }, data: { customFields: merge(cf, itemId) } }); },
    };
    for (const kind of MARKETING_KINDS) {
      const markRow = markers[kind];
      // The date correction first: it touches only tasks that already exist,
      // and the count on the report moves per task. The dates and the zone
      // marker land together, so the task reads as anchored from then on
      // (legacyDateCorrection skips it) and a later run in another zone
      // never moves it again. The marker is set in place (jsonb_set) rather
      // than read and written back whole, so an edit a person makes to the
      // task's fields meanwhile is not overwritten by this run's older copy.
      for (const { itemId, patch } of redates[kind]) {
        await prisma.$transaction([
          prisma.item.update({ where: { id: itemId }, data: patch }),
          prisma.$executeRaw`
            UPDATE "Item" SET metadata = jsonb_set(metadata, ${[ITEM_PROVENANCE_KEY, "dateZone"]}::text[], to_jsonb(${zone}::text))
            WHERE id = ${itemId} AND jsonb_typeof(metadata->(${ITEM_PROVENANCE_KEY}::text)) = 'object'`,
        ]);
        report.kinds[kind].redated += 1;
      }
      for (const { row, itemId } of relinks[kind]) await markRow(row.id, row.customFields, itemId);
      for (const { row, task } of plans[kind]) {
        const item = await createBoardItem(
          {
            organizationId,
            boardId: listIds[kind]!,
            title: task.title,
            status: task.status,
            ownerId: task.ownerId ?? undefined,
            startAt: task.startAt,
            dueAt: task.dueAt,
            metadata: task.metadata,
            actorId,
          },
          { trustedMetadata: true },
        );
        await markRow(row.id, row.customFields, item.id);
        report.kinds[kind].written += 1;
      }
    }

    // 4. Read back: every source row now names a task that exists in the
    //    organization, live or in Trash. Existence, not the List: a person
    //    may since have moved a migrated task to another List, and that is
    //    theirs to do; and a task they trashed is still the row's task.
    const [c2, ci2, e2] = await Promise.all([
      prisma.campaign.findMany({ where: { organizationId }, select: { customFields: true } }),
      prisma.contentItem.findMany({ where: { organizationId }, select: { customFields: true } }),
      prisma.eventBrief.findMany({ where: { organizationId }, select: { customFields: true } }),
    ]);
    const check = async (kind: MarketingKind, rows: Array<{ customFields: unknown }>) => {
      const marks = rows.map((r) => migratedItemId(r.customFields));
      if (marks.some((id) => !id)) throw new Error(`${kind}: ${marks.filter((id) => !id).length} row(s) have no ${MIGRATED_ITEM_KEY} after the write`);
      const ids = marks as string[];
      const live = new Set((await prisma.item.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } })).map((i) => i.id));
      const away = ids.filter((id) => !live.has(id));
      const inTrash = away.length ? new Set((await loadTrashedMarketingTasks(organizationId, away)).map((t) => t.id)) : new Set<string>();
      const held = ids.filter((id) => live.has(id) || inTrash.has(id)).length;
      if (held !== ids.length) throw new Error(`${kind}: ${ids.length} row(s) marked, ${held} task(s) found in the workspace or its Trash`);
    };
    await check("campaigns", c2);
    await check("content", ci2);
    await check("events", e2);
    report.verified = true;
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    report.verified = false;
  }
}

/** The provenance key, exported for the resolver's tests and the script's report. */
export { ITEM_PROVENANCE_KEY };
