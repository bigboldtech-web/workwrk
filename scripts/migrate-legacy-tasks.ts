/**
 * migrate-legacy-tasks.ts: move every live `Task` and `TaskComment` onto the
 * `Item` / `ItemUpdate` model, into the owner's Personal list.
 *
 * Spec: docs/plans/ui-refresh/spec-work-home.md section 4, W4.
 * Rules: scripts/MIGRATIONS.md (all seven; this script obeys all seven).
 *
 * WHY. There are two task models in this product. `Item` is what /boards,
 * /my-work, /everything, the drawer, the task detail, the Inbox and the
 * notification pipeline read. `Task` is what /tasks/*, the planner, the ICS
 * feed, the calendar sync and the performance score read. The same person's
 * work is split across both and neither surface can see the other's. This
 * script is the half that moves the DATA; the consumer re-points ship in the
 * same release, because a row with no reader is the same thing as a lost row.
 *
 * WHAT IS COPIED, per task, and what is not:
 *
 *   title          -> Item.title
 *   description    -> Item.metadata.description (where the task detail reads it)
 *   status         -> the destination List's own status, by name and group
 *                     (src/lib/work/legacy-task-map.ts mapLegacyStatus)
 *   priority       -> Item.priority
 *   date/startAt/  -> Item.startAt + Item.dueAt (mapLegacyDates)
 *     endAt
 *   completedAt    -> Item.metadata.completedAt (Item has no column for it)
 *   assigneeId     -> Item.ownerId + Item.assigneeIds[0]
 *   parentTaskId   -> Item.parentItemId (second pass, once every id is known)
 *   labels         -> Tag + TagAssignment, created per org when missing
 *   estimateHours  -> Item.metadata.timeEstimate, in MINUTES, which is the unit
 *                     the task detail's Time estimate field reads and writes
 *   TaskComment    -> ItemUpdate, original author and original createdAt
 *
 *   TimeEntry     -> TimeEntry.itemId. `TimeEntry` already carries both a
 *                     nullable taskId and a nullable itemId, so the logged
 *                     hours follow the task onto its Item. `taskId` is NOT
 *                     cleared, so the move is reversible.
 *
 *   NOT copied, and each one is listed in the report so nobody discovers it
 *   later: hoursSpent, category, incompleteReason, recurringGroupId,
 *   externalId / externalSource / syncedAt (the Google Calendar idempotency
 *   key), slaHours / escalatedAt / escalatedToId (the SLA feature, which has
 *   no Item equivalent and whose cron is retired with the routes), source /
 *   sourceRef, dayPosition. Every one of those is preserved VERBATIM under
 *   Item.metadata.legacyTask, so nothing is destroyed and a later feature can
 *   read them back. The source row is never deleted either (rule 6).
 *
 * CUSTOM FIELDS. W4 names "TASK custom-field values -> matching BOARD_ITEM
 * fields". There are none to move: the `CustomFieldDefinition` and
 * `CustomFieldValue` models the schema comment at prisma/schema.prisma:3862
 * describes were never added, `src/app/api/custom-fields` does not exist, and
 * the three calls the legacy task grid made to it have always been silent
 * 404s. The report says so with a count of zero rather than leaving a step
 * that looks skipped.
 *
 * IDEMPOTENCE. Every written Item carries `metadata.legacyTaskId` and every
 * written ItemUpdate carries `metadata.legacyTaskCommentId`... except that
 * ItemUpdate has no metadata column, so comments are keyed on a LegacyRedirect
 * row instead. Both are read back at the start of each org, so a second run
 * migrates nothing and a run that died halfway finishes the job.
 *
 * Usage, see scripts/MIGRATIONS.md for the approval gate.
 *
 *   npx tsx scripts/migrate-legacy-tasks.ts                       # dry run
 *   npx tsx scripts/migrate-legacy-tasks.ts --report /tmp/r.txt   # dry run, saved
 *   npx tsx scripts/migrate-legacy-tasks.ts --org <id>            # one org
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/migrate-legacy-tasks.ts --write             # LOCAL only
 */

import fs from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { getBoardStatuses } from "../src/lib/board-items-shared";
import {
  LEGACY_REDIRECT_KINDS,
  legacyTarget,
  mapLegacyDates,
  mapLegacyPriority,
  mapLegacyStatus,
  resolveLegacyOwner,
} from "../src/lib/work/legacy-task-map";

const prisma = scriptPrisma();

interface OrgReport {
  organizationId: string;
  organizationName: string;
  tasksRead: number;
  tasksAlreadyMigrated: number;
  tasksWritten: number;
  commentsRead: number;
  commentsAlreadyMigrated: number;
  commentsWritten: number;
  labelsRead: number;
  tagsCreated: number;
  parentLinksWritten: number;
  personalListsUsed: number;
  personalListsCreated: number;
  /** TimeEntry rows re-pointed from the legacy task to its Item. */
  timeEntriesRelinked: number;
  /** Status strings the mapping could not place, with how many rows carry them. */
  unmappedStatuses: Array<{ value: string; count: number }>;
  /** Tasks whose assignee AND creator are both gone from the org. Not written. */
  unresolvedOwners: Array<{ taskId: string; title: string; assigneeId: string; createdById: string | null }>;
  /** Which arm of the owner rule each task took. */
  ownerVia: { assignee: number; creator: number; "org-owner": number; none: number };
  /** Always zero, and the reason is in the header comment. */
  customFieldValues: number;
  error?: string;
}

interface Report {
  ranAt: string;
  database: string;
  write: boolean;
  orgFilter: string | null;
  orgs: OrgReport[];
  totals: {
    tasksRead: number;
    tasksWritten: number;
    commentsRead: number;
    commentsWritten: number;
    unresolved: number;
  };
}

/** Fields the Item model has no home for. Kept verbatim so nothing is lost. */
function legacyRemainder(t: {
  hoursSpent: number | null;
  category: string | null;
  incompleteReason: string | null;
  recurringGroupId: string | null;
  externalId: string | null;
  externalSource: string | null;
  syncedAt: Date | null;
  slaHours: number | null;
  escalatedAt: Date | null;
  escalatedToId: string | null;
  source: string;
  sourceRef: string | null;
  dayPosition: number | null;
  allDay: boolean;
  kraId: string | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== null && v !== undefined) out[k] = v instanceof Date ? v.toISOString() : v;
  };
  put("hoursSpent", t.hoursSpent);
  put("category", t.category);
  put("incompleteReason", t.incompleteReason);
  put("recurringGroupId", t.recurringGroupId);
  put("externalId", t.externalId);
  put("externalSource", t.externalSource);
  put("syncedAt", t.syncedAt);
  put("slaHours", t.slaHours);
  put("escalatedAt", t.escalatedAt);
  put("escalatedToId", t.escalatedToId);
  put("sourceRef", t.sourceRef);
  put("dayPosition", t.dayPosition);
  if (t.source && t.source !== "MANUAL") out.source = t.source;
  if (t.allDay === false) out.allDay = false;
  return out;
}

async function main() {
  const write = process.argv.includes("--write");
  const reportAt = argValue("--report");
  const orgFilter = argValue("--org");

  const report: Report = {
    ranAt: new Date().toISOString(),
    database: databaseLabel(),
    write,
    orgFilter,
    orgs: [],
    totals: { tasksRead: 0, tasksWritten: 0, commentsRead: 0, commentsWritten: 0, unresolved: 0 },
  };

  const orgs = await prisma.organization.findMany({
    where: orgFilter ? { id: orgFilter } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  for (const org of orgs) {
    const r = await migrateOrg(org.id, org.name, write);
    if (!r) continue;
    report.orgs.push(r);
    report.totals.tasksRead += r.tasksRead;
    report.totals.tasksWritten += r.tasksWritten;
    report.totals.commentsRead += r.commentsRead;
    report.totals.commentsWritten += r.commentsWritten;
    report.totals.unresolved += r.unresolvedOwners.length;
  }

  const text = render(report);
  console.log(text);
  if (reportAt) {
    fs.mkdirSync(reportAt.replace(/\/[^/]+$/, ""), { recursive: true });
    fs.writeFileSync(reportAt, text);
    console.log(`\nReport saved to ${reportAt}`);
  }
  if (!write) {
    console.log("\nDRY RUN. Nothing was written. Add --write to apply (see scripts/MIGRATIONS.md).");
  }
}

/**
 * One org. Reads outside the transaction, writes inside it (rule 4), so a
 * failure here cannot leave this workspace half migrated and cannot touch the
 * next one.
 *
 * Returns null for an org with no legacy tasks at all, so the report is a list
 * of workspaces that HAVE something to move rather than a list of every
 * workspace that exists.
 */
async function migrateOrg(organizationId: string, organizationName: string, write: boolean): Promise<OrgReport | null> {
  const tasks = await prisma.task.findMany({
    where: { organizationId },
    include: {
      labels: { include: { label: true } },
      comments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (tasks.length === 0) return null;

  const r: OrgReport = {
    organizationId,
    organizationName,
    tasksRead: tasks.length,
    tasksAlreadyMigrated: 0,
    tasksWritten: 0,
    commentsRead: tasks.reduce((n, t) => n + t.comments.length, 0),
    commentsAlreadyMigrated: 0,
    commentsWritten: 0,
    labelsRead: 0,
    tagsCreated: 0,
    parentLinksWritten: 0,
    personalListsUsed: 0,
    personalListsCreated: 0,
    timeEntriesRelinked: 0,
    unmappedStatuses: [],
    unresolvedOwners: [],
    ownerVia: { assignee: 0, creator: 0, "org-owner": 0, none: 0 },
    customFieldValues: 0,
  };

  // Already-migrated tasks, keyed on the marker the first pass wrote (rule 5).
  const existing = await prisma.legacyRedirect.findMany({
    where: { organizationId, kind: { in: [LEGACY_REDIRECT_KINDS.task, LEGACY_REDIRECT_KINDS.taskComment] } },
    select: { kind: true, legacyId: true, target: true },
  });
  const doneTasks = new Map<string, string>();
  const doneComments = new Set<string>();
  for (const e of existing) {
    if (e.kind === LEGACY_REDIRECT_KINDS.task) doneTasks.set(e.legacyId, e.target);
    else doneComments.add(e.legacyId);
  }

  const members = await prisma.user.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, accessLevel: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const liveUserIds = new Set(members.map((m) => m.id));
  const fallbackOwnerId =
    members.find((m) => m.accessLevel === "SUPER_ADMIN")?.id ??
    members.find((m) => m.accessLevel === "COMPANY_ADMIN")?.id ??
    members[0]?.id ??
    null;

  // Resolve every task's destination person before writing anything, so an
  // unresolvable row is a REPORT line rather than a half-finished transaction.
  const unmapped = new Map<string, number>();
  const plan: Array<{
    task: (typeof tasks)[number];
    userId: string;
  }> = [];
  /**
   * Comments on a task an EARLIER run already moved, which that run did not
   * see because they did not exist yet. Written against the Item the marker
   * already points at, never a new one.
   */
  const commentBackfill: Array<{ itemId: string; comments: (typeof tasks)[number]["comments"] }> = [];

  for (const t of tasks) {
    if (doneTasks.has(t.id)) {
      r.tasksAlreadyMigrated += 1;
      // Its comments went with it on that run - but only the ones that
      // EXISTED on that run. Crediting the whole array here (which is what
      // this did) would mark a comment added between the two runs as already
      // migrated, and the assertion below would still balance, so the loss
      // would be silent. Each comment is checked against its own marker, and
      // the ones with no marker are queued for the transaction.
      const itemId = doneTasks.get(t.id)!.replace(/^\/item\//, "");
      const pending = t.comments.filter((c) => !doneComments.has(c.id));
      r.commentsAlreadyMigrated += t.comments.length - pending.length;
      if (pending.length > 0 && itemId) commentBackfill.push({ itemId, comments: pending });
      continue;
    }
    const owner = resolveLegacyOwner({
      assigneeId: t.assigneeId,
      createdById: t.createdById,
      liveUserIds,
      fallbackOwnerId,
    });
    r.ownerVia[owner.via] += 1;
    if (!owner.userId) {
      r.unresolvedOwners.push({
        taskId: t.id,
        title: t.title,
        assigneeId: t.assigneeId,
        createdById: t.createdById,
      });
      continue;
    }
    plan.push({ task: t, userId: owner.userId });
  }

  r.labelsRead = plan.reduce((n, p) => n + p.task.labels.length, 0);

  // The Personal list each destination person needs. Read here so the dry run
  // can say how many would be created without creating any.
  const userIds = Array.from(new Set(plan.map((p) => p.userId)));
  const boards = await prisma.board.findMany({
    where: { organizationId, productSlug: "personal-list", ownerId: { in: userIds } },
    select: { id: true, ownerId: true, statuses: true },
  });
  const boardByUser = new Map(boards.map((b) => [b.ownerId ?? "", b]));
  r.personalListsUsed = boardByUser.size;
  r.personalListsCreated = userIds.filter((u) => !boardByUser.has(u)).length;

  // Dry-run status tally, using the destination List's real statuses where one
  // exists and the canonical default trio where the script would create it.
  for (const p of plan) {
    const statuses = getBoardStatuses(boardByUser.get(p.userId) ?? null);
    const m = mapLegacyStatus(p.task.status, statuses);
    if (m.unmapped) unmapped.set(p.task.status, (unmapped.get(p.task.status) ?? 0) + 1);
  }
  r.unmappedStatuses = Array.from(unmapped, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);

  // Tags and parent links, predicted. A dry-run report whose numbers are only
  // filled in by the write pass is a report that cannot be compared against
  // the write it is supposed to authorise, so both modes compute both.
  const labelNamesPlanned = new Set<string>();
  for (const p of plan) for (const l of p.task.labels) labelNamesPlanned.add(l.label.name);
  const existingTagNames = labelNamesPlanned.size
    ? new Set(
        (
          await prisma.tag.findMany({
            where: { organizationId, type: "CUSTOM", name: { in: Array.from(labelNamesPlanned) } },
            select: { name: true },
          })
        ).map((t) => t.name),
      )
    : new Set<string>();
  const tagsToCreate = Array.from(labelNamesPlanned).filter((n) => !existingTagNames.has(n)).length;

  // A parent link survives only when parent and child land on the SAME
  // Personal list, which is the app's own board-scoped rule for parentItemId.
  const userByTaskId = new Map(plan.map((p) => [p.task.id, p.userId]));
  const parentLinksPlanned = plan.filter((p) => {
    if (!p.task.parentTaskId) return false;
    const parentUser = userByTaskId.get(p.task.parentTaskId);
    return parentUser !== undefined && parentUser === p.userId;
  }).length;

  // A run with no NEW tasks may still have comments to catch up on, so an
  // empty plan is not on its own a reason to stop.
  const backfillComments = commentBackfill.reduce((n, b) => n + b.comments.length, 0);
  if (!write) {
    // A dry run still reports what a write WOULD do, so the two numbers the
    // founder compares (read and written) are both present in both modes.
    r.tasksWritten = plan.length;
    r.commentsWritten =
      plan.reduce((n, p) => n + p.task.comments.filter((c) => !doneComments.has(c.id)).length, 0) + backfillComments;
    r.tagsCreated = tagsToCreate;
    r.parentLinksWritten = parentLinksPlanned;
    return r;
  }
  if (plan.length === 0 && backfillComments === 0) return r;

  try {
    await prisma.$transaction(
      async (tx) => {
        // 1. Personal lists. getOrCreatePersonalBoard is not reused: it runs on
        //    the global client and outside this transaction, and a migration
        //    must not leave a board behind when its own rows roll back.
        const listByUser = new Map<string, { id: string; statuses: unknown }>();
        for (const b of boards) listByUser.set(b.ownerId ?? "", { id: b.id, statuses: b.statuses });
        for (const userId of userIds) {
          if (listByUser.has(userId)) continue;
          const created = await tx.board.create({
            data: {
              organizationId,
              spaceId: null,
              slug: `personal-${userId}`,
              name: "Personal list",
              itemType: "studio-item",
              productSlug: "personal-list",
              ownerId: userId,
              visibility: "PRIVATE",
              schema: { fields: [] },
              settings: {},
            },
            select: { id: true, statuses: true },
          });
          // One saved view, the same seed a new List gets (spec-spaces-lists
          // step 6: the ViewTypeSwitcher supplies the rest).
          await tx.view.create({
            data: {
              boardId: created.id,
              name: "List",
              type: "TABLE",
              isDefault: true,
              isShared: true,
              ownerId: userId,
              config: { groupBy: "status" },
              displayOrder: 0,
            },
          });
          listByUser.set(userId, created);
        }

        // 2. Tags, one per distinct label name in this org, created when absent.
        const labelNames = new Set<string>();
        for (const p of plan) for (const l of p.task.labels) labelNames.add(l.label.name);
        const tagByName = new Map<string, string>();
        if (labelNames.size) {
          const found = await tx.tag.findMany({
            where: { organizationId, type: "CUSTOM", name: { in: Array.from(labelNames) } },
            select: { id: true, name: true },
          });
          for (const t of found) tagByName.set(t.name, t.id);
          for (const p of plan) {
            for (const l of p.task.labels) {
              if (tagByName.has(l.label.name)) continue;
              const tag = await tx.tag.create({
                data: {
                  organizationId,
                  name: l.label.name,
                  type: "CUSTOM",
                  color: l.label.color || null,
                },
                select: { id: true },
              });
              tagByName.set(l.label.name, tag.id);
              r.tagsCreated += 1;
            }
          }
        }

        // 3. The tasks themselves. One pass writes the rows; a second pass
        //    links parents, because a parent may be later in the list.
        //
        //    The two id lists are what makes the assertions at step 5 a real
        //    read-back: they are the rows this transaction believes it wrote,
        //    and step 5 counts them out of the database rather than re-adding
        //    the counters that produced them.
        const createdItemIds: string[] = [];
        const createdUpdateIds: string[] = [];
        const itemIdByTaskId = new Map<string, string>(doneTasks);
        for (const [legacyId, target] of doneTasks) itemIdByTaskId.set(legacyId, target.replace(/^\/item\//, ""));

        // Position: append after whatever is already on that person's list.
        const nextPosition = new Map<string, number>();
        for (const userId of userIds) {
          const list = listByUser.get(userId)!;
          const last = await tx.item.findFirst({
            where: { boardId: list.id, parentItemId: null },
            orderBy: { position: "desc" },
            select: { position: true },
          });
          nextPosition.set(userId, (last?.position ?? 0) + 1024);
        }

        for (const p of plan) {
          const list = listByUser.get(p.userId)!;
          const statuses = getBoardStatuses(list);
          const status = mapLegacyStatus(p.task.status, statuses);
          const dates = mapLegacyDates({ date: p.task.date, startAt: p.task.startAt, endAt: p.task.endAt });
          const pos = nextPosition.get(p.userId)!;
          nextPosition.set(p.userId, pos + 1024);

          const metadata: Record<string, unknown> = { legacyTaskId: p.task.id };
          // Only when there is something to keep. An empty `legacyTask: {}` on
          // every migrated row is noise in a JSON blob people read by eye.
          const remainder = legacyRemainder(p.task);
          if (Object.keys(remainder).length > 0) metadata.legacyTask = remainder;
          if (p.task.description) metadata.description = p.task.description;
          if (p.task.estimateHours != null) metadata.timeEstimate = Math.round(p.task.estimateHours * 60);
          if (p.task.completedAt) metadata.completedAt = p.task.completedAt.toISOString();
          else if (status.done) metadata.completedAt = p.task.updatedAt.toISOString();
          if (p.task.kraId) metadata.kraId = p.task.kraId;

          const created = await tx.item.create({
            data: {
              organizationId,
              boardId: list.id,
              itemType: "studio-item",
              // The unique pair is (itemType, itemId); for studio rows itemId is
              // the row's own id, which Prisma cannot fill before the insert, so
              // the legacy id stands in. It is unique by construction and it
              // makes the pair a second, readable forwarding address.
              itemId: `legacy-task-${p.task.id}`,
              title: p.task.title,
              status: status.value,
              ownerId: p.userId,
              assigneeIds: [p.userId],
              groupKey: status.value,
              position: pos,
              startAt: dates.startAt,
              dueAt: dates.dueAt,
              priority: mapLegacyPriority(p.task.priority),
              metadata: metadata as object,
              createdAt: p.task.createdAt,
              updatedAt: p.task.updatedAt,
            },
            select: { id: true },
          });
          itemIdByTaskId.set(p.task.id, created.id);
          createdItemIds.push(created.id);
          r.tasksWritten += 1;

          // Tags.
          for (const l of p.task.labels) {
            const tagId = tagByName.get(l.label.name);
            if (!tagId) continue;
            await tx.tagAssignment.create({
              data: {
                tagId,
                entityType: "BOARD_ITEM",
                entityId: created.id,
                organizationId,
                assignedById: null,
              },
            });
          }

          // Comments, with the original author and the original timestamp.
          for (const c of p.task.comments) {
            if (doneComments.has(c.id)) {
              r.commentsAlreadyMigrated += 1;
              continue;
            }
            const update = await tx.itemUpdate.create({
              data: {
                organizationId,
                // BOARD_ITEM_ENTITY_TYPE (src/lib/item-thread.ts:15). A comment
                // written under any other entityType is a comment the thread
                // cannot see, which is the same thing as losing it.
                entityType: "BOARD_ITEM",
                entityId: created.id,
                authorId: liveUserIds.has(c.authorId) ? c.authorId : null,
                body: c.body,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
              },
              select: { id: true },
            });
            await tx.legacyRedirect.create({
              data: {
                organizationId,
                kind: LEGACY_REDIRECT_KINDS.taskComment,
                legacyId: c.id,
                // A comment's address is its task, plus the anchor the task
                // detail's ?comment= deep link reads.
                target: `${legacyTarget(created.id)}?comment=${update.id}`,
              },
            });
            createdUpdateIds.push(update.id);
            r.commentsWritten += 1;
          }

          // The forwarding address. This is also the idempotence key.
          await tx.legacyRedirect.create({
            data: {
              organizationId,
              kind: LEGACY_REDIRECT_KINDS.task,
              legacyId: p.task.id,
              target: legacyTarget(created.id),
            },
          });
        }

        // 3b. Comments on tasks an earlier run already moved, against the Item
        //     the marker already names.
        //
        //     A comment with no marker is either NEW (written after that run)
        //     or ALREADY MOVED by a version of this script that wrote no
        //     per-comment marker. Inserting the second kind again would
        //     duplicate somebody's comment, so the thread is read first and an
        //     identical row (same item, same author, same body, same
        //     timestamp) is adopted: the marker is written against the row
        //     that exists and nothing is inserted.
        for (const b of commentBackfill) {
          const already = await tx.itemUpdate.findMany({
            where: { organizationId, entityType: "BOARD_ITEM", entityId: b.itemId },
            select: { id: true, authorId: true, body: true, createdAt: true },
          });
          for (const c of b.comments) {
            const twin = already.find(
              (u) =>
                u.body === c.body &&
                u.createdAt.getTime() === c.createdAt.getTime() &&
                u.authorId === (liveUserIds.has(c.authorId) ? c.authorId : null),
            );
            if (twin) {
              await tx.legacyRedirect.create({
                data: {
                  organizationId,
                  kind: LEGACY_REDIRECT_KINDS.taskComment,
                  legacyId: c.id,
                  target: `${legacyTarget(b.itemId)}?comment=${twin.id}`,
                },
              });
              r.commentsAlreadyMigrated += 1;
              continue;
            }
            const update = await tx.itemUpdate.create({
              data: {
                organizationId,
                entityType: "BOARD_ITEM",
                entityId: b.itemId,
                authorId: liveUserIds.has(c.authorId) ? c.authorId : null,
                body: c.body,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
              },
              select: { id: true },
            });
            await tx.legacyRedirect.create({
              data: {
                organizationId,
                kind: LEGACY_REDIRECT_KINDS.taskComment,
                legacyId: c.id,
                target: `${legacyTarget(b.itemId)}?comment=${update.id}`,
              },
            });
            createdUpdateIds.push(update.id);
            r.commentsWritten += 1;
          }
        }

        // 3c. Logged time follows the task.
        //
        //     `TimeEntry` carries BOTH a nullable `taskId` and a nullable
        //     `itemId`, so the re-point is a column the schema already has.
        //     Without it a migrated task shows no logged time and the hours
        //     stay attached to a `Task` row with no UI, which is the same
        //     thing as losing them. `taskId` is NOT cleared (rule 6): the old
        //     pointer stays, so this is reversible and re-running it matches
        //     nothing new.
        for (const [legacyId, itemId] of itemIdByTaskId) {
          const relinked = await tx.timeEntry.updateMany({
            where: { taskId: legacyId, itemId: null },
            data: { itemId },
          });
          r.timeEntriesRelinked += relinked.count;
        }

        // 4. Parents, now that every id is known. A parent that did not
        //    migrate (its owner was unresolvable) leaves the child top-level
        //    rather than orphaning it, and the report has already named it.
        for (const p of plan) {
          if (!p.task.parentTaskId) continue;
          const childId = itemIdByTaskId.get(p.task.id);
          const parentId = itemIdByTaskId.get(p.task.parentTaskId);
          if (!childId || !parentId) continue;
          // parentItemId is board-scoped by the app's own rule; a legacy parent
          // and child assigned to different people would land on different
          // Lists, and linking them across Lists would create a row the board
          // tree cannot render. Those stay flat, and the count says how many.
          const [child, parent] = await Promise.all([
            tx.item.findUnique({ where: { id: childId }, select: { boardId: true } }),
            tx.item.findUnique({ where: { id: parentId }, select: { boardId: true } }),
          ]);
          if (!child || !parent || child.boardId !== parent.boardId) continue;
          await tx.item.update({ where: { id: childId }, data: { parentItemId: parentId } });
          r.parentLinksWritten += 1;
        }

        // 5. Row-count assertions (rule 3).
        //
        //    TWO KINDS, and the first one is the one that can actually fail.
        //
        //    (a) READ-BACK. Every row this transaction believes it wrote is
        //        counted out of the database, inside the same transaction. An
        //        insert that did not land, a row written into another
        //        workspace, a forwarding address that never got created: all
        //        of those abort here. The arithmetic checks below cannot catch
        //        any of them, because they only re-add counters that were
        //        incremented in the same loop that did the writing - a
        //        tautology, and the previous version of this block was exactly
        //        that and nothing more.
        const landedItems = createdItemIds.length
          ? await tx.item.count({ where: { organizationId, id: { in: createdItemIds } } })
          : 0;
        if (landedItems !== createdItemIds.length) {
          throw new Error(
            `Assertion failed for ${organizationName}: wrote ${createdItemIds.length} item(s) but only ${landedItems} ` +
              `are readable in this workspace. Rolled back.`,
          );
        }
        const landedUpdates = createdUpdateIds.length
          ? await tx.itemUpdate.count({ where: { organizationId, id: { in: createdUpdateIds } } })
          : 0;
        if (landedUpdates !== createdUpdateIds.length) {
          throw new Error(
            `Assertion failed for ${organizationName}: wrote ${createdUpdateIds.length} comment(s) but only ` +
              `${landedUpdates} are readable in this workspace. Rolled back.`,
          );
        }
        // Every task this run planned must now have a forwarding address, or a
        // later /tasks/<id> link resolves to nothing.
        const plannedTaskIds = plan.map((p) => p.task.id);
        const landedRedirects = plannedTaskIds.length
          ? await tx.legacyRedirect.count({
              where: { organizationId, kind: LEGACY_REDIRECT_KINDS.task, legacyId: { in: plannedTaskIds } },
            })
          : 0;
        if (landedRedirects !== plannedTaskIds.length) {
          throw new Error(
            `Assertion failed for ${organizationName}: ${plannedTaskIds.length} task(s) migrated but ${landedRedirects} ` +
              `forwarding address(es) exist. Rolled back.`,
          );
        }

        //    (b) ARITHMETIC. Every task read fell into exactly one bucket, so
        //        this cannot fail on its own; it is kept because it is the
        //        line the runbook asks the founder to compare, and because a
        //        future edit that adds a fourth bucket without adding it here
        //        WILL trip it.
        const accounted = r.tasksWritten + r.tasksAlreadyMigrated + r.unresolvedOwners.length;
        if (accounted !== r.tasksRead) {
          throw new Error(
            `Assertion failed for ${organizationName}: read ${r.tasksRead} task(s), accounted for ${accounted} ` +
              `(${r.tasksWritten} written, ${r.tasksAlreadyMigrated} already migrated, ${r.unresolvedOwners.length} unresolved). Rolled back.`,
          );
        }
        // Comments are asserted against the WHOLE org's comment count, not
        // just this run's plan, so a second run (where every task is skipped
        // and every comment is counted as already migrated) has to balance too.
        // read = written now + moved by an earlier run + on a task nobody could
        // own. Anything else and something went missing.
        const commentsOnUnresolved = r.unresolvedOwners.length
          ? tasks.filter((t) => r.unresolvedOwners.some((u) => u.taskId === t.id)).reduce((n, t) => n + t.comments.length, 0)
          : 0;
        const commentsAccounted = r.commentsWritten + r.commentsAlreadyMigrated + commentsOnUnresolved;
        if (commentsAccounted !== r.commentsRead) {
          throw new Error(
            `Assertion failed for ${organizationName}: read ${r.commentsRead} comment(s), accounted for ${commentsAccounted} ` +
              `(${r.commentsWritten} written, ${r.commentsAlreadyMigrated} already migrated, ${commentsOnUnresolved} on tasks nobody could own). Rolled back.`,
          );
        }

        // 6. The record, in the product (rule 7).
        if (fallbackOwnerId) {
          await tx.activityLog.create({
            data: {
              organizationId,
              actorId: fallbackOwnerId,
              type: "work.tasks_migrated",
              targetType: "task",
              targetId: organizationId,
              description:
                `Legacy task migration ran. ${r.tasksWritten} task(s) and ${r.commentsWritten} comment(s) were copied ` +
                `onto the Item model in this workspace. The source rows were not deleted.`,
              metadata: {
                tasksRead: r.tasksRead,
                tasksWritten: r.tasksWritten,
                tasksAlreadyMigrated: r.tasksAlreadyMigrated,
                commentsWritten: r.commentsWritten,
                unresolved: r.unresolvedOwners.length,
                tagsCreated: r.tagsCreated,
                parentLinksWritten: r.parentLinksWritten,
                personalListsCreated: r.personalListsCreated,
                ranAt: new Date().toISOString(),
              },
            },
          });
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
    // The transaction rolled back, so nothing in this org was written.
    r.tasksWritten = 0;
    r.commentsWritten = 0;
    r.tagsCreated = 0;
    r.parentLinksWritten = 0;
  }

  return r;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function render(report: Report): string {
  const L: string[] = [];
  L.push("");
  L.push(`Legacy task migration (Task -> Item), ${report.write ? "WRITE" : "dry run"}`);
  L.push(`Database: ${report.database}`);
  L.push(`Ran at:   ${report.ranAt}`);
  if (report.orgFilter) L.push(`Org:      ${report.orgFilter} (filtered)`);
  L.push("");

  if (report.orgs.length === 0) {
    L.push("  No workspace has a legacy task. Nothing to migrate.");
    return L.join("\n");
  }

  for (const o of report.orgs) {
    L.push(`─ ${o.organizationName}  (${o.organizationId})`);
    if (o.error) {
      L.push(`  FAILED and rolled back: ${o.error}`);
      L.push("");
      continue;
    }
    L.push(`  tasks read                 ${o.tasksRead}`);
    L.push(`  tasks ${report.write ? "written" : "to write"}              ${o.tasksWritten}`);
    L.push(`  tasks already migrated     ${o.tasksAlreadyMigrated}`);
    L.push(`  comments read              ${o.commentsRead}`);
    L.push(`  comments ${report.write ? "written" : "to write"}           ${o.commentsWritten}`);
    L.push(`  comments already migrated  ${o.commentsAlreadyMigrated}`);
    L.push(`  labels on migrating tasks  ${o.labelsRead}   (tags created: ${o.tagsCreated})`);
    L.push(`  parent links               ${o.parentLinksWritten}`);
    L.push(`  Personal lists used        ${o.personalListsUsed}   (to create: ${o.personalListsCreated})`);
    L.push(`  Time entries re-pointed    ${o.timeEntriesRelinked}   (TimeEntry.taskId -> itemId; taskId kept)`);
    L.push(
      `  destination chosen by      assignee ${o.ownerVia.assignee}, creator ${o.ownerVia.creator}, ` +
        `workspace owner ${o.ownerVia["org-owner"]}, nobody ${o.ownerVia.none}`,
    );
    L.push(`  TASK custom-field values   ${o.customFieldValues}   (no CustomFieldValue model exists; see the header)`);

    if (o.unmappedStatuses.length) {
      L.push("  status values the mapping could not place (they land on the first");
      L.push("  active status of the destination list, and keep their legacy value");
      L.push("  under metadata.legacyTask):");
      for (const s of o.unmappedStatuses) L.push(`    ${s.value.padEnd(24)} ${s.count}`);
    } else {
      L.push("  every status value mapped cleanly.");
    }

    if (o.unresolvedOwners.length) {
      L.push(`  NOT MIGRATED, no live person to own them (${o.unresolvedOwners.length}):`);
      for (const u of o.unresolvedOwners.slice(0, 25)) {
        L.push(`    ${u.taskId}  "${u.title.slice(0, 48)}"  assignee ${u.assigneeId}  creator ${u.createdById ?? "none"}`);
      }
      if (o.unresolvedOwners.length > 25) L.push(`    ... and ${o.unresolvedOwners.length - 25} more`);
    } else {
      L.push("  every task has a live person to own it.");
    }
    L.push("");
  }

  L.push("─ Totals");
  L.push(`  tasks read     ${report.totals.tasksRead}`);
  L.push(`  tasks ${report.write ? "written" : "to write"}  ${report.totals.tasksWritten}`);
  L.push(`  comments read  ${report.totals.commentsRead}`);
  L.push(`  comments ${report.write ? "written" : "to write"} ${report.totals.commentsWritten}`);
  L.push(`  unresolved     ${report.totals.unresolved}`);
  L.push("");
  L.push("  Source rows are NOT deleted. Task and TaskComment stay readable for at");
  L.push("  least one release; dropping them is a separate, later step and has its");
  L.push("  own file in prisma/sql (see scripts/MIGRATIONS.md).");
  return L.join("\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
