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
//     row whose `customFields.migratedItemId` names a task that still exists
//     is skipped, so a second run moves only what the first did not;
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
  LIST_MARKER_KEY,
  LIST_NAME,
  MARKETING_KINDS,
  MARKETING_TEMPLATE_KEY,
  MIGRATED_ITEM_KEY,
  SPACE_MARKER_KEY,
  TEMPLATE_NOT_READY,
  marketingTemplateProblem,
  type LegacyDates,
  type MappedTask,
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
  /** Rows with no task yet: never moved, or the task was deleted for good from Trash. Per kind. */
  toWrite: LegacyMarketingCounts;
  /** Moved tasks still holding a date exactly as the legacy row stored it, which the next write anchors in `zone`. */
  toRedate: number;
  zone: string;
}

/**
 * What a write would still do, for the Settings > Data row: it decides
 * whether Preview and Import render once the Space exists. Same reading of
 * "done" as the import (the mark names a task that exists, in any state).
 */
export async function pendingLegacyMarketing(organizationId: string, zone: string): Promise<LegacyPending> {
  const rows = await loadLegacyRows(organizationId);
  const items = await loadClaimedItems(organizationId, rows);
  const toWrite: LegacyMarketingCounts = { campaigns: 0, content: 0, events: 0 };
  let toRedate = 0;
  for (const kind of MARKETING_KINDS) {
    for (const row of rows[kind]) {
      const held = items.get(migratedId(row.customFields) ?? "");
      if (!held) toWrite[kind] += 1;
      else if (legacyDateCorrection(kind, row, zone, held)) toRedate += 1;
    }
  }
  return { toWrite, toRedate, zone };
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

/**
 * The tasks the rows' marks name, confirmed against the Item table, with the
 * dates they hold today. A task in Trash still counts: the person chose to
 * trash it, and a re-run must not bring it back as a second copy.
 */
async function loadClaimedItems(organizationId: string, rows: Record<MarketingKind, Array<{ customFields: unknown }>>): Promise<Map<string, LegacyDates>> {
  const claimed = MARKETING_KINDS.flatMap((k) => rows[k].map((r) => migratedId(r.customFields))).filter((id): id is string => Boolean(id));
  if (!claimed.length) return new Map();
  const found = await prisma.item.findMany({ where: { organizationId, id: { in: claimed } }, select: { id: true, startAt: true, dueAt: true } });
  return new Map(found.map((i) => [i.id, { startAt: i.startAt, dueAt: i.dueAt }]));
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
  const id = (row.customFields as Record<string, unknown> | null)?.[MIGRATED_ITEM_KEY];
  if (typeof id !== "string" || !id) return { exists: true, itemId: null, trashed: false };
  const item = await prisma.item.findFirst({ where: { id, organizationId }, select: { id: true, archivedAt: true } });
  if (!item) return { exists: true, itemId: null, trashed: false };
  if (item.archivedAt) return { exists: true, itemId: null, trashed: true };
  return { exists: true, itemId: item.id, trashed: false };
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
  /** After a write: every source row points at a task that exists. */
  verified?: boolean;
}

export function emptyKind(): KindReport {
  return { read: 0, alreadyMigrated: 0, written: 0, relinked: 0, statusMoved: 0, unmappedStatuses: [], unmappedFields: [], ownerDropped: 0, currencyMismatch: 0, redated: 0, listSlug: null, listCreated: false };
}

function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sorted<K extends string>(map: Map<string, number>, name: K): Array<Record<K, string> & { count: number }> {
  return Array.from(map, ([k, count]) => ({ [name]: k, count }) as Record<K, string> & { count: number }).sort((a, b) => b.count - a.count);
}

function migratedId(customFields: unknown): string | null {
  const id = (customFields as Record<string, unknown> | null)?.[MIGRATED_ITEM_KEY];
  return typeof id === "string" && id ? id : null;
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

  // Rows an earlier run already moved, confirmed against the Item table
  // (loadClaimedItems says why a task in Trash counts), with the dates each
  // task holds today, for the correction below.
  const existingItems = await loadClaimedItems(organizationId, { campaigns, content, events });
  const heldTask = (customFields: unknown) => existingItems.get(migratedId(customFields) ?? "") ?? null;

  // Tasks the marker Lists already hold, by the row their provenance names:
  // the crash window (task created, row not yet marked) resolves to a
  // re-link instead of a duplicate.
  const taskByRow = new Map<string, string>();
  const markerListIds = found ? MARKETING_KINDS.map((k) => found.listIds[k]).filter((id): id is string => Boolean(id)) : [];
  if (markerListIds.length) {
    const held = await prisma.item.findMany({
      where: { organizationId, boardId: { in: markerListIds } },
      select: { id: true, metadata: true },
    });
    for (const item of held) {
      const prov = (item.metadata as Record<string, unknown> | null)?.[ITEM_PROVENANCE_KEY] as Record<string, unknown> | undefined;
      const kind = prov?.kind;
      const rowId = prov?.id;
      if (typeof kind === "string" && typeof rowId === "string" && !taskByRow.has(`${kind}:${rowId}`)) taskByRow.set(`${kind}:${rowId}`, item.id);
    }
  }

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
    const held = heldTask(row.customFields);
    if (held) {
      k.alreadyMigrated += 1;
      const patch = legacyDateCorrection(kind, row, zone, held);
      if (patch) {
        k.redated += 1;
        redates[kind].push({ itemId: migratedId(row.customFields)!, patch });
      }
      return;
    }
    const onList = taskByRow.get(`${kind}:${row.id}`);
    if (onList) {
      k.relinked += 1;
      relinks[kind].push({ row, itemId: onList });
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
      // one column write each, and the count on the report moves per task.
      for (const { itemId, patch } of redates[kind]) {
        await prisma.item.update({ where: { id: itemId }, data: patch });
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
    //    organization. Existence, not the List: a person may since have moved
    //    a migrated task to another List, and that is theirs to do.
    const [c2, ci2, e2] = await Promise.all([
      prisma.campaign.findMany({ where: { organizationId }, select: { customFields: true } }),
      prisma.contentItem.findMany({ where: { organizationId }, select: { customFields: true } }),
      prisma.eventBrief.findMany({ where: { organizationId }, select: { customFields: true } }),
    ]);
    const check = async (kind: MarketingKind, rows: Array<{ customFields: unknown }>) => {
      const ids = rows.map((r) => migratedId(r.customFields));
      if (ids.some((id) => !id)) throw new Error(`${kind}: ${ids.filter((id) => !id).length} row(s) have no ${MIGRATED_ITEM_KEY} after the write`);
      const live = await prisma.item.count({ where: { organizationId, id: { in: ids as string[] } } });
      if (live !== ids.length) throw new Error(`${kind}: ${ids.length} row(s) marked, ${live} task(s) found in the workspace`);
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
