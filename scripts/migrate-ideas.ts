/**
 * migrate-ideas.ts: move every `Idea` onto an Item on a real List, seeded
 * from the built-in "Ideas board" template.
 *
 * Spec: docs/plans/ui-refresh/spec-work-home.md section 4, W5.
 * Rules: scripts/MIGRATIONS.md (all seven).
 *
 * WHY. `/ideas` was a voting kanban with its own five API routes, its own
 * six-member status enum and no sidebar row anywhere. It is a List: rows with
 * a status, a description, an owner, votes and comments. Keeping a second
 * task-shaped model alive for one page is the split this phase exists to
 * close. THE ORDER MATTERS MORE HERE THAN ANYWHERE ELSE: a 308 from /ideas
 * before this script has run is not a redirect, it is a delete, because those
 * rows would have no destination. The redirect is added only after the
 * production run (scripts/MIGRATIONS.md).
 *
 * WHERE THEY LAND. One List per org, named "Ideas", created from the built-in
 * template `list.ideas-board` (prisma/seed-templates.ts) so its statuses are
 * the enum's own six values and its fields are Votes and Category. It goes in
 * the org's oldest workspace-visible Space, because an idea was visible to the
 * whole org and landing them in a private Space would hide them from the
 * people who wrote them. An org with no such Space is REPORTED and SKIPPED,
 * never guessed at.
 *
 * WHAT IS COPIED:
 *   title          -> Item.title
 *   description    -> Item.metadata.description
 *   status         -> the List's matching status (mapIdeaStatus)
 *   submitterId    -> Item.ownerId + assigneeIds[0]
 *   category       -> Item.metadata.category
 *   votes (count)  -> Item.metadata.votes, and the voters' ids under
 *                     metadata.legacyIdea.voterIds so a later upvote field can
 *                     rebuild the real thing rather than starting from a number
 *   position       -> Item.position (scaled), so the hand-sorted order survives
 *   IdeaComment    -> ItemUpdate with the original author and timestamp
 *   reviewer, reviewNotes, reward* -> metadata.legacyIdea, verbatim
 *
 * Usage, see scripts/MIGRATIONS.md for the approval gate.
 *
 *   npx tsx scripts/migrate-ideas.ts                        # dry run
 *   npx tsx scripts/migrate-ideas.ts --report /tmp/r.txt    # dry run, saved
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/migrate-ideas.ts --write              # LOCAL only
 */

import fs from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { getBoardStatuses } from "../src/lib/board-items-shared";
import { LEGACY_REDIRECT_KINDS, legacyTarget, mapIdeaStatus } from "../src/lib/work/legacy-task-map";

const prisma = scriptPrisma();

/** The interactive-transaction client, which is the full client minus lifecycle methods. */
type TxClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$use" | "$extends" | "$transaction">;

/** The built-in template this migration seeds its destination List from. */
const IDEAS_TEMPLATE_KEY = "list.ideas-board";
/** The name the destination List gets. naming-canon: sentence case, one word. */
const IDEAS_LIST_NAME = "Ideas";

interface OrgReport {
  organizationId: string;
  organizationName: string;
  ideasRead: number;
  ideasAlreadyMigrated: number;
  ideasWritten: number;
  commentsRead: number;
  commentsAlreadyMigrated: number;
  commentsWritten: number;
  votesRead: number;
  /** Vote totals re-stamped onto ideas an earlier run already moved. */
  votesRefreshed: number;
  listSlug: string | null;
  listCreated: boolean;
  /** How the destination List was found: its provenance marker, or its name. */
  listMatchedBy: "marker" | "name" | null;
  unmappedStatuses: Array<{ value: string; count: number }>;
  /** Ideas whose submitter has left the org. Not written. */
  unresolvedSubmitters: Array<{ ideaId: string; title: string; submitterId: string }>;
  /** Set when this org cannot be migrated at all, with the reason. */
  blocked?: string;
  error?: string;
}

interface Report {
  ranAt: string;
  database: string;
  write: boolean;
  orgFilter: string | null;
  templateFound: boolean;
  orgs: OrgReport[];
  totals: { ideasRead: number; ideasWritten: number; commentsRead: number; commentsWritten: number; blocked: number };
}

async function main() {
  const write = process.argv.includes("--write");
  const reportAt = argValue("--report");
  const orgFilter = argValue("--org");

  const template = await prisma.template.findFirst({
    where: { key: IDEAS_TEMPLATE_KEY },
    select: { id: true, payload: true },
  });

  const report: Report = {
    ranAt: new Date().toISOString(),
    database: databaseLabel(),
    write,
    orgFilter,
    templateFound: Boolean(template),
    orgs: [],
    totals: { ideasRead: 0, ideasWritten: 0, commentsRead: 0, commentsWritten: 0, blocked: 0 },
  };

  if (!template) {
    console.log(render(report));
    console.log(
      `\nThe built-in template "${IDEAS_TEMPLATE_KEY}" is not in this database. Seed it first:\n` +
        `  npx tsx prisma/seed-templates.ts --write\n` +
        `Nothing was read and nothing was written.`,
    );
    return;
  }

  const orgs = await prisma.organization.findMany({
    where: orgFilter ? { id: orgFilter } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  for (const org of orgs) {
    const r = await migrateOrg(org.id, org.name, write, template.payload as Record<string, unknown>);
    if (!r) continue;
    report.orgs.push(r);
    report.totals.ideasRead += r.ideasRead;
    report.totals.ideasWritten += r.ideasWritten;
    report.totals.commentsRead += r.commentsRead;
    report.totals.commentsWritten += r.commentsWritten;
    if (r.blocked) report.totals.blocked += 1;
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

async function migrateOrg(
  organizationId: string,
  organizationName: string,
  write: boolean,
  payload: Record<string, unknown>,
): Promise<OrgReport | null> {
  const ideas = await prisma.idea.findMany({
    where: { organizationId },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      votes: { select: { userId: true } },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  if (ideas.length === 0) return null;

  const r: OrgReport = {
    organizationId,
    organizationName,
    ideasRead: ideas.length,
    ideasAlreadyMigrated: 0,
    ideasWritten: 0,
    commentsRead: ideas.reduce((n, i) => n + i.comments.length, 0),
    commentsAlreadyMigrated: 0,
    commentsWritten: 0,
    votesRead: ideas.reduce((n, i) => n + i.votes.length, 0),
    votesRefreshed: 0,
    listSlug: null,
    listCreated: false,
    listMatchedBy: null,
    unmappedStatuses: [],
    unresolvedSubmitters: [],
  };

  const existing = await prisma.legacyRedirect.findMany({
    where: {
      organizationId,
      kind: { in: [LEGACY_REDIRECT_KINDS.idea, LEGACY_REDIRECT_KINDS.ideaComment] },
    },
    select: { kind: true, legacyId: true, target: true },
  });
  const done = new Map<string, string>();
  // Per-comment markers, the twin of the task migration's. Without these an
  // idea's comments had no idempotence key at all, and /ideas stays live and
  // writable until the production run, so a comment or a vote added between
  // two runs is the normal case.
  const doneComments = new Set<string>();
  for (const e of existing) {
    if (e.kind === LEGACY_REDIRECT_KINDS.idea) done.set(e.legacyId, e.target);
    else doneComments.add(e.legacyId);
  }

  const members = await prisma.user.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, accessLevel: true },
    orderBy: { createdAt: "asc" },
  });
  const liveUserIds = new Set(members.map((m) => m.id));
  const actorId =
    members.find((m) => m.accessLevel === "SUPER_ADMIN")?.id ??
    members.find((m) => m.accessLevel === "COMPANY_ADMIN")?.id ??
    members[0]?.id ??
    null;

  // The destination Space: the oldest one the whole workspace can see. An idea
  // was org-wide, so a PRIVATE Space is the wrong home even when it is the
  // only one; an org with none is blocked rather than guessed at.
  const space = await prisma.space.findFirst({
    where: { organizationId, archivedAt: null, visibility: { in: ["ORG", "WORKSPACE"] } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (!space) {
    r.blocked =
      "no workspace-visible Space to put the Ideas list in. Create one (or make an existing Space visible to the workspace) and run again.";
    return r;
  }
  if (!actorId) {
    r.blocked = "no live member to own the Ideas list.";
    return r;
  }

  // The destination List, matched by the MARKER this migration writes, then by
  // name.
  //
  // Name alone was wrong and could not be made right: an org that already has
  // a person-made list called "Ideas" in its oldest workspace-visible Space
  // would have had every legacy idea dumped into somebody's real board, and
  // the report would have printed that board's slug under "destination list"
  // with nothing to say it was not this script's own. The marker
  // (`Board.settings.legacyIdeasList`) is written on creation, so from the
  // first run onward the match is exact. The name fallback only matters for a
  // workspace migrated by the version of this script that had no marker, and
  // it is REPORTED so the founder can see which rule matched.
  const markedList = await prisma.board.findFirst({
    where: {
      organizationId,
      spaceId: space.id,
      archivedAt: null,
      settings: { path: ["legacyIdeasList"], equals: true },
    },
    select: { id: true, slug: true, statuses: true },
  });
  const existingList =
    markedList ??
    (await prisma.board.findFirst({
      where: { organizationId, spaceId: space.id, name: IDEAS_LIST_NAME, archivedAt: null },
      select: { id: true, slug: true, statuses: true },
    }));
  r.listMatchedBy = markedList ? "marker" : existingList ? "name" : null;
  r.listSlug = existingList?.slug ?? null;
  r.listCreated = !existingList;

  /** Comments on an idea an earlier run already moved, which it never saw. */
  const commentBackfill: Array<{ itemId: string; comments: (typeof ideas)[number]["comments"] }> = [];
  /** Vote totals to re-stamp on already-migrated ideas. */
  const voteRefresh: Array<{ itemId: string; votes: number; voterIds: string[] }> = [];

  const templateStatuses = Array.isArray(payload.statuses) ? payload.statuses : null;
  const statuses = getBoardStatuses(existingList ?? { statuses: templateStatuses });

  const plan = ideas.filter((i) => {
    if (done.has(i.id)) {
      r.ideasAlreadyMigrated += 1;
      // Only the comments that actually carry a marker are credited. The rest
      // are queued against the Item the marker already names, so a comment
      // written between two runs is migrated rather than counted as done.
      const itemId = done.get(i.id)!.replace(/^\/item\//, "");
      const pending = i.comments.filter((c) => !doneComments.has(c.id));
      r.commentsAlreadyMigrated += i.comments.length - pending.length;
      if (itemId) {
        if (pending.length > 0) commentBackfill.push({ itemId, comments: pending });
        // Votes are a COUNT on the Item, not rows, so a vote cast after the
        // migration has nothing to re-read it. Re-stamping the number (and the
        // voter ids) on every run is what keeps it true.
        voteRefresh.push({ itemId, votes: i.votes.length, voterIds: i.votes.map((v) => v.userId) });
      }
      return false;
    }
    if (!liveUserIds.has(i.submitterId)) {
      r.unresolvedSubmitters.push({ ideaId: i.id, title: i.title, submitterId: i.submitterId });
      return false;
    }
    return true;
  });

  const unmapped = new Map<string, number>();
  for (const i of plan) {
    const m = mapIdeaStatus(i.status, statuses);
    if (m.unmapped) unmapped.set(i.status, (unmapped.get(i.status) ?? 0) + 1);
  }
  r.unmappedStatuses = Array.from(unmapped, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);

  // Vote totals that would actually CHANGE. Computed here, before the write,
  // so the dry run reports the same number the write performs rather than the
  // size of the queue: "2 to refresh" followed by "0 refreshed" is a report
  // the founder cannot reconcile.
  if (voteRefresh.length > 0) {
    const current = await prisma.item.findMany({
      where: { organizationId, id: { in: voteRefresh.map((v) => v.itemId) } },
      select: { id: true, metadata: true },
    });
    const mdById = new Map(current.map((c) => [c.id, (c.metadata ?? {}) as Record<string, unknown>]));
    const changed = voteRefresh.filter((v) => {
      const md = mdById.get(v.itemId);
      if (!md) return false;
      const legacy = (md.legacyIdea ?? {}) as Record<string, unknown>;
      return md.votes !== v.votes || JSON.stringify(legacy.voterIds ?? []) !== JSON.stringify(v.voterIds);
    });
    voteRefresh.length = 0;
    voteRefresh.push(...changed);
  }

  // A run with nothing NEW to migrate may still have comments or vote totals
  // to catch up on, so `plan.length === 0` is not on its own a reason to stop.
  const backfillComments = commentBackfill.reduce((n, b) => n + b.comments.length, 0);
  if (!write) {
    r.ideasWritten = plan.length;
    // The backfill is counted here too, or the dry run prints "comments read
    // 1, to write 0, already migrated 0" and leaves a row unaccounted for.
    r.commentsWritten = plan.reduce((n, i) => n + i.comments.length, 0) + backfillComments;
    r.votesRefreshed = voteRefresh.length;
    return r;
  }
  if (plan.length === 0 && backfillComments === 0 && voteRefresh.length === 0) return r;

  try {
    await prisma.$transaction(
      async (tx) => {
        // 1. The destination List, from the template payload, once per org.
        let listId = existingList?.id ?? null;
        let listStatuses = statuses;
        if (!listId) {
          const slug = await uniqueSlug(tx, organizationId, "ideas");
          const created = await tx.board.create({
            data: {
              organizationId,
              spaceId: space.id,
              slug,
              name: IDEAS_LIST_NAME,
              description: typeof payload.description === "string" ? payload.description : null,
              itemType: "studio-item",
              icon: typeof payload.icon === "string" ? payload.icon : "Lightbulb",
              color: typeof payload.color === "string" ? payload.color : null,
              ownerId: actorId,
              visibility: "WORKSPACE",
              schema: { fields: Array.isArray(payload.fields) ? payload.fields : [] },
              statuses: (templateStatuses ?? []) as object,
              // The provenance marker. It is what lets a later run find THIS
              // list rather than any board somebody happened to call "Ideas".
              settings: { legacyIdeasList: true },
            },
            select: { id: true, slug: true, statuses: true },
          });
          listId = created.id;
          r.listSlug = created.slug;
          listStatuses = getBoardStatuses(created);
          // The template's own views (Board first, then List).
          const views = Array.isArray(payload.views) ? payload.views : [];
          let order = 0;
          for (const v of views as Array<{ type?: string; name?: string; config?: object }>) {
            if (!v?.type) continue;
            await tx.view.create({
              data: {
                boardId: listId,
                name: v.name ?? v.type,
                type: v.type as never,
                isDefault: order === 0,
                isShared: true,
                ownerId: actorId,
                config: (v.config ?? {}) as object,
                displayOrder: order++,
              },
            });
          }
          if (order === 0) {
            await tx.view.create({
              data: {
                boardId: listId,
                name: "List",
                type: "TABLE",
                isDefault: true,
                isShared: true,
                ownerId: actorId,
                config: { groupBy: "status" },
                displayOrder: 0,
              },
            });
          }
        }

        // 2. The ideas. Position preserved so a hand-sorted board stays sorted.
        //    The two id lists feed the read-back assertions at step 3.
        const createdItemIds: string[] = [];
        const createdUpdateIds: string[] = [];
        const last = await tx.item.findFirst({
          where: { boardId: listId, parentItemId: null },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        let pos = (last?.position ?? 0) + 1024;

        for (const idea of plan) {
          const status = mapIdeaStatus(idea.status, listStatuses);
          const legacy: Record<string, unknown> = { ideaPosition: idea.position };
          if (idea.reviewerId) legacy.reviewerId = idea.reviewerId;
          if (idea.reviewNotes) legacy.reviewNotes = idea.reviewNotes;
          if (idea.rewardType) legacy.rewardType = idea.rewardType;
          if (idea.rewardValue) legacy.rewardValue = idea.rewardValue;
          if (idea.rewardedAt) legacy.rewardedAt = idea.rewardedAt.toISOString();
          if (idea.votes.length) legacy.voterIds = idea.votes.map((v) => v.userId);

          const metadata: Record<string, unknown> = {
            legacyIdeaId: idea.id,
            legacyIdea: legacy,
            votes: idea.votes.length,
          };
          if (idea.description) metadata.description = idea.description;
          if (idea.category) metadata.category = idea.category;

          const created = await tx.item.create({
            data: {
              organizationId,
              boardId: listId,
              itemType: "studio-item",
              itemId: `legacy-idea-${idea.id}`,
              title: idea.title,
              status: status.value,
              ownerId: idea.submitterId,
              assigneeIds: [idea.submitterId],
              groupKey: status.value,
              position: pos,
              metadata: metadata as object,
              createdAt: idea.createdAt,
              updatedAt: idea.updatedAt,
            },
            select: { id: true },
          });
          pos += 1024;
          createdItemIds.push(created.id);
          r.ideasWritten += 1;

          for (const c of idea.comments) {
            const update = await tx.itemUpdate.create({
              data: {
                organizationId,
                // BOARD_ITEM_ENTITY_TYPE (src/lib/item-thread.ts:15).
                entityType: "BOARD_ITEM",
                entityId: created.id,
                authorId: liveUserIds.has(c.userId) ? c.userId : null,
                body: c.content,
                createdAt: c.createdAt,
                updatedAt: c.createdAt,
              },
              select: { id: true },
            });
            // The per-comment marker (rule 5). It is also a real forwarding
            // address: the anchor the task detail's ?comment= deep link reads.
            await tx.legacyRedirect.create({
              data: {
                organizationId,
                kind: LEGACY_REDIRECT_KINDS.ideaComment,
                legacyId: c.id,
                target: `${legacyTarget(created.id)}?comment=${update.id}`,
              },
            });
            createdUpdateIds.push(update.id);
            r.commentsWritten += 1;
          }

          await tx.legacyRedirect.create({
            data: {
              organizationId,
              kind: LEGACY_REDIRECT_KINDS.idea,
              legacyId: idea.id,
              target: legacyTarget(created.id),
            },
          });
        }

        // 2b. Comments on ideas an earlier run already moved.
        //
        //     A comment here has no marker, and there are two reasons for
        //     that, which need opposite treatment:
        //       1. it was written AFTER that run, and must be migrated;
        //       2. that run migrated it, but the version of this script that
        //          did so wrote no per-comment marker (the markers arrived
        //          later), so the ItemUpdate is already sitting on the Item.
        //     Writing (2) again would DUPLICATE somebody's comment, which is
        //     worse than the gap it is fixing. So the thread is read first and
        //     an identical row (same item, same author, same body, same
        //     timestamp) is adopted: the marker is written against the row
        //     that already exists, nothing is inserted, and from then on this
        //     comment is keyed like any other.
        for (const b of commentBackfill) {
          const already = await tx.itemUpdate.findMany({
            where: { organizationId, entityType: "BOARD_ITEM", entityId: b.itemId },
            select: { id: true, authorId: true, body: true, createdAt: true },
          });
          for (const c of b.comments) {
            const twin = already.find(
              (u) =>
                u.body === c.content &&
                u.createdAt.getTime() === c.createdAt.getTime() &&
                u.authorId === (liveUserIds.has(c.userId) ? c.userId : null),
            );
            if (twin) {
              await tx.legacyRedirect.create({
                data: {
                  organizationId,
                  kind: LEGACY_REDIRECT_KINDS.ideaComment,
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
                authorId: liveUserIds.has(c.userId) ? c.userId : null,
                body: c.content,
                createdAt: c.createdAt,
                updatedAt: c.createdAt,
              },
              select: { id: true },
            });
            await tx.legacyRedirect.create({
              data: {
                organizationId,
                kind: LEGACY_REDIRECT_KINDS.ideaComment,
                legacyId: c.id,
                target: `${legacyTarget(b.itemId)}?comment=${update.id}`,
              },
            });
            createdUpdateIds.push(update.id);
            r.commentsWritten += 1;
          }
        }

        // 2c. Vote totals, re-stamped on already-migrated ideas.
        //
        //     A vote is a COUNT on the Item, not a row, so unlike a comment it
        //     has nothing of its own to carry a marker. /ideas stays live and
        //     writable until the production run, so a vote cast between two
        //     runs would otherwise be invisible for ever. Written as a MERGE
        //     over the stored blob, never a wholesale replace, so nothing else
        //     in metadata is touched.
        for (const v of voteRefresh) {
          const row = await tx.item.findUnique({ where: { id: v.itemId }, select: { metadata: true } });
          if (!row) continue;
          const md = { ...((row.metadata ?? {}) as Record<string, unknown>) };
          const legacy = { ...((md.legacyIdea ?? {}) as Record<string, unknown>) };
          if (md.votes === v.votes && JSON.stringify(legacy.voterIds ?? []) === JSON.stringify(v.voterIds)) continue;
          md.votes = v.votes;
          if (v.voterIds.length) legacy.voterIds = v.voterIds;
          md.legacyIdea = legacy;
          await tx.item.update({ where: { id: v.itemId }, data: { metadata: md as object } });
          r.votesRefreshed += 1;
        }

        // 3. Assertions (rule 3).
        //
        //    (a) READ-BACK, the half that can actually fail: every row this
        //        transaction believes it wrote, counted out of the database
        //        inside the same transaction. The arithmetic below only
        //        re-adds counters incremented by the loops that did the
        //        writing, so on its own it can never catch an insert that did
        //        not land.
        const landedItems = createdItemIds.length
          ? await tx.item.count({ where: { organizationId, id: { in: createdItemIds } } })
          : 0;
        if (landedItems !== createdItemIds.length) {
          throw new Error(
            `Assertion failed for ${organizationName}: wrote ${createdItemIds.length} idea(s) but only ${landedItems} ` +
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
        const plannedIdeaIds = plan.map((i) => i.id);
        const landedRedirects = plannedIdeaIds.length
          ? await tx.legacyRedirect.count({
              where: { organizationId, kind: LEGACY_REDIRECT_KINDS.idea, legacyId: { in: plannedIdeaIds } },
            })
          : 0;
        if (landedRedirects !== plannedIdeaIds.length) {
          throw new Error(
            `Assertion failed for ${organizationName}: ${plannedIdeaIds.length} idea(s) migrated but ${landedRedirects} ` +
              `forwarding address(es) exist. Rolled back.`,
          );
        }

        const accounted = r.ideasWritten + r.ideasAlreadyMigrated + r.unresolvedSubmitters.length;
        if (accounted !== r.ideasRead) {
          throw new Error(
            `Assertion failed for ${organizationName}: read ${r.ideasRead} idea(s), accounted for ${accounted} ` +
              `(${r.ideasWritten} written, ${r.ideasAlreadyMigrated} already migrated, ${r.unresolvedSubmitters.length} unresolved). Rolled back.`,
          );
        }
        const commentsOnUnresolved = r.unresolvedSubmitters.length
          ? ideas
              .filter((i) => r.unresolvedSubmitters.some((u) => u.ideaId === i.id))
              .reduce((n, i) => n + i.comments.length, 0)
          : 0;
        const commentsAccounted = r.commentsWritten + r.commentsAlreadyMigrated + commentsOnUnresolved;
        if (commentsAccounted !== r.commentsRead) {
          throw new Error(
            `Assertion failed for ${organizationName}: read ${r.commentsRead} comment(s), accounted for ${commentsAccounted}. Rolled back.`,
          );
        }

        // 4. The record (rule 7).
        await tx.activityLog.create({
          data: {
            organizationId,
            actorId,
            type: "work.ideas_migrated",
            targetType: "board",
            targetId: listId,
            description:
              `Ideas migration ran. ${r.ideasWritten} idea(s) and ${r.commentsWritten} comment(s) moved onto the ` +
              `"${IDEAS_LIST_NAME}" list in ${space.name}. The source rows were not deleted.`,
            metadata: {
              ideasRead: r.ideasRead,
              ideasWritten: r.ideasWritten,
              commentsWritten: r.commentsWritten,
              votesRead: r.votesRead,
              unresolved: r.unresolvedSubmitters.length,
              listSlug: r.listSlug,
              ranAt: new Date().toISOString(),
            },
          },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
    r.ideasWritten = 0;
    r.commentsWritten = 0;
    r.listCreated = false;
  }

  return r;
}

/** A slug nobody in this org is using. Boards are unique on slug per org. */
async function uniqueSlug(tx: TxClient, organizationId: string, base: string): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await tx.board.findFirst({
      where: { organizationId, slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function render(report: Report): string {
  const L: string[] = [];
  L.push("");
  L.push(`Ideas migration (Idea -> Item), ${report.write ? "WRITE" : "dry run"}`);
  L.push(`Database: ${report.database}`);
  L.push(`Ran at:   ${report.ranAt}`);
  L.push(`Template: ${report.templateFound ? `${IDEAS_TEMPLATE_KEY} found` : `${IDEAS_TEMPLATE_KEY} NOT FOUND`}`);
  if (report.orgFilter) L.push(`Org:      ${report.orgFilter} (filtered)`);
  L.push("");

  if (!report.templateFound) return L.join("\n");
  if (report.orgs.length === 0) {
    L.push("  No workspace has an idea. Nothing to migrate.");
    return L.join("\n");
  }

  for (const o of report.orgs) {
    L.push(`─ ${o.organizationName}  (${o.organizationId})`);
    if (o.blocked) {
      L.push(`  BLOCKED, nothing read or written: ${o.blocked}`);
      L.push(`  ideas waiting: ${o.ideasRead}`);
      L.push("");
      continue;
    }
    if (o.error) {
      L.push(`  FAILED and rolled back: ${o.error}`);
      L.push("");
      continue;
    }
    L.push(`  ideas read                ${o.ideasRead}`);
    L.push(`  ideas ${report.write ? "written" : "to write"}             ${o.ideasWritten}`);
    L.push(`  ideas already migrated    ${o.ideasAlreadyMigrated}`);
    L.push(`  comments read             ${o.commentsRead}`);
    L.push(`  comments ${report.write ? "written" : "to write"}          ${o.commentsWritten}`);
    L.push(`  comments already migrated ${o.commentsAlreadyMigrated}`);
    L.push(`  votes read                ${o.votesRead}   (kept as metadata.votes plus the voter ids)`);
    L.push(`  vote totals ${report.write ? "refreshed" : "to refresh"}   ${o.votesRefreshed}   (on ideas an earlier run moved)`);
    L.push(
      `  destination list          ${o.listSlug ? `/boards/${o.listSlug}` : "(does not exist yet)"}` +
        `${o.listCreated ? (report.write ? "  [created by this run]" : "  [this run would create it]") : ""}` +
        `${o.listMatchedBy === "marker" ? "  [this migration's own list]" : ""}` +
        `${o.listMatchedBy === "name" ? "  [MATCHED BY NAME - check this is not somebody's own board]" : ""}`,
    );
    if (o.unmappedStatuses.length) {
      L.push("  status values with no row on the Ideas list:");
      for (const s of o.unmappedStatuses) L.push(`    ${s.value.padEnd(20)} ${s.count}`);
    } else {
      L.push("  every status value mapped cleanly.");
    }
    if (o.unresolvedSubmitters.length) {
      L.push(`  NOT MIGRATED, the person who submitted them has left (${o.unresolvedSubmitters.length}):`);
      for (const u of o.unresolvedSubmitters.slice(0, 25)) {
        L.push(`    ${u.ideaId}  "${u.title.slice(0, 48)}"  submitter ${u.submitterId}`);
      }
    } else {
      L.push("  every idea has a live submitter.");
    }
    L.push("");
  }

  L.push("─ Totals");
  L.push(`  ideas read     ${report.totals.ideasRead}`);
  L.push(`  ideas ${report.write ? "written" : "to write"}  ${report.totals.ideasWritten}`);
  L.push(`  comments read  ${report.totals.commentsRead}`);
  L.push(`  comments ${report.write ? "written" : "to write"} ${report.totals.commentsWritten}`);
  L.push(`  workspaces blocked ${report.totals.blocked}`);
  L.push("");
  L.push("  Source rows are NOT deleted. Idea, IdeaVote and IdeaComment stay readable.");
  L.push("  /ideas keeps its page until this has run in production: redirecting first");
  L.push("  would send people to a list their rows are not on, which is a delete.");
  return L.join("\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
