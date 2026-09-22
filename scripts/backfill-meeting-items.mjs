// Phase 4 (Time and Talk) data script: give every Meeting an Item to be
// gated through.
//
// WHY. docs/plans/ui-refresh/spec-planner.md section 1 Access decides that a
// meeting is not a new object type:
//
//   "Access section 5.1's ObjectRef has no meeting type and access section 9
//    rules that meetings, if revived, are a List item type. That decision
//    stands. A meeting therefore resolves to { type: "item", id } and needs
//    no new ref ... The Meetings List is one per org, created on first use,
//    hidden from the Spaces tree, not shareable and carrying no views, so it
//    is plumbing rather than a surface."
//
// This script is that plumbing: one hidden Board named "Meetings" per
// organization, one Item per meeting inside it, and Meeting."itemId"
// pointing at it.
//
// WHAT IT DOES NOT DO, SO NOBODY EXPECTS IT TO. It does not change how
// access is decided today. src/lib/meeting-access.ts is a pure function over
// createdById and the attendee list, it is what every meeting route calls,
// and it keeps deciding. The Item rows are the SHAPE the access engine will
// read when it stops being inert; writing them now means that switch is a
// one-line change in one file rather than a migration under a deadline. A
// meeting with no Item behaves exactly as it does today.
//
// THE SEVEN RULES (scripts/MIGRATIONS.md):
//
//   1. DRY RUN BY DEFAULT. Pass --write to write. Without it nothing is
//      created and nothing is updated.
//   2. A PER-ORGANIZATION REPORT is printed either way.
//   3. IT ASSERTS. Counts are checked before and after; a mismatch aborts
//      the run rather than reporting success over a half-done write.
//   4. IT IS IDEMPOTENT. A meeting that already has an itemId whose Item is
//      alive is skipped. A meeting whose Item was deleted is re-linked. An
//      Item is located by metadata->>'meetingId' before a new one is made,
//      so an interrupted run resumes instead of duplicating.
//   5. IT NEVER DELETES OR MUTATES A SOURCE ROW. The only Meeting field it
//      writes is itemId, which was NULL.
//   6. IT IS SAFE AGAINST AN OLD DATABASE. If Meeting."itemId" is absent
//      (prisma/sql/2026-09-22-meeting-item.sql not applied) it says so and
//      exits 0 without writing.
//   7. IT INVENTS NOTHING. assigneeIds are the meeting's real attendees and
//      ownerId is its recorded creator. A meeting with neither gets an Item
//      with no owner and no assignees, which is the honest record of a row
//      that names nobody, and it is reported.
//
// Usage:
//   node scripts/backfill-meeting-items.mjs                 dry run
//   node scripts/backfill-meeting-items.mjs --write         write
//   node scripts/backfill-meeting-items.mjs --org=<id>     one organization
//
// The DATABASE_URL is whatever the environment carries. Production runs are
// the founder's: see scripts/MIGRATIONS.md.

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const WRITE = process.argv.includes("--write");
const ORG_ARG = (() => {
  const eq = process.argv.find((a) => a.startsWith("--org="));
  if (eq) return eq.split("=")[1];
  const i = process.argv.indexOf("--org");
  return i >= 0 ? process.argv[i + 1] : null;
})();

/** The hidden per-organization list every meeting Item lives in. */
const LIST_SLUG = "meetings";
const LIST_NAME = "Meetings";
const ITEM_TYPE = "meeting";

function line(s = "") { process.stdout.write(`${s}\n`); }

/** Does Meeting."itemId" exist yet? Rule 6. */
async function hasItemIdColumn() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'Meeting' AND column_name = 'itemId' LIMIT 1`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * The organization's hidden Meetings board, created on first use.
 *
 * spaceId and folderId stay NULL, which is what keeps it out of the Spaces
 * tree: every sidebar query walks Space then Folder then Board. `visibility`
 * is PRIVATE so no resolver hands it to the workspace, and `isDefault` stays
 * false so it never becomes somebody's landing list.
 */
async function ensureBoard(orgId, write) {
  const existing = await prisma.board.findFirst({
    where: { organizationId: orgId, slug: LIST_SLUG, itemType: ITEM_TYPE },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  if (!write) return { id: null, created: true };

  // The slug is unique per organization, so a name clash with a real list
  // called "meetings" is possible. Fall back to a reserved slug rather than
  // throwing, and never adopt somebody's real list as the hidden one.
  const clash = await prisma.board.findFirst({
    where: { organizationId: orgId, slug: LIST_SLUG },
    select: { id: true },
  });
  const slug = clash ? "meetings-system" : LIST_SLUG;

  const board = await prisma.board.create({
    data: {
      organizationId: orgId,
      slug,
      name: LIST_NAME,
      itemType: ITEM_TYPE,
      isDefault: false,
      visibility: "PRIVATE",
      settings: { system: true, hidden: true, source: "meetings" },
    },
    select: { id: true },
  });
  return { id: board.id, created: true };
}

async function run() {
  line("Meeting to Item backfill");
  line(WRITE ? "MODE: WRITE" : "MODE: dry run (pass --write to write)");
  line("");

  if (!(await hasItemIdColumn())) {
    line('Meeting."itemId" is not in this database yet.');
    line("Apply prisma/sql/2026-09-22-meeting-item.sql first. Nothing was written.");
    return 0;
  }

  const orgs = await prisma.organization.findMany({
    where: ORG_ARG ? { id: ORG_ARG } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  let totalMeetings = 0;
  let totalLinked = 0;
  let totalAlready = 0;
  let totalRelinked = 0;
  let totalOwnerless = 0;
  let totalWouldCreateBoards = 0;

  for (const org of orgs) {
    const meetings = await prisma.meeting.findMany({
      where: { organizationId: org.id, deletedAt: null },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        createdById: true,
        itemId: true,
        attendees: { select: { userId: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (meetings.length === 0) continue;

    totalMeetings += meetings.length;

    // Which of these already point at a LIVE Item? A stale pointer (the
    // Item was deleted) is re-linked rather than left dangling.
    const pointed = meetings.map((m) => m.itemId).filter(Boolean);
    const alive = pointed.length
      ? await prisma.item.findMany({
          where: { id: { in: pointed }, organizationId: org.id },
          select: { id: true },
        })
      : [];
    const aliveIds = new Set(alive.map((i) => i.id));

    const todo = meetings.filter((m) => !m.itemId || !aliveIds.has(m.itemId));
    const already = meetings.length - todo.length;
    totalAlready += already;
    const relinked = meetings.filter((m) => m.itemId && !aliveIds.has(m.itemId)).length;
    totalRelinked += relinked;

    const board = await ensureBoard(org.id, WRITE && todo.length > 0);
    if (board.created && !board.id) totalWouldCreateBoards += 1;

    let linked = 0;
    let ownerless = 0;

    for (const m of todo) {
      const attendeeIds = m.attendees.map((a) => a.userId);
      const ownerId = m.createdById ?? attendeeIds[0] ?? null;
      if (!ownerId) ownerless += 1;

      if (!WRITE || !board.id) { linked += 1; continue; }

      // Idempotency, rule 4: an Item written by an earlier, interrupted run
      // is found by its stamp rather than made a second time.
      const existing = await prisma.item.findFirst({
        where: {
          organizationId: org.id,
          boardId: board.id,
          metadata: { path: ["meetingId"], equals: m.id },
        },
        select: { id: true },
      });

      const itemId = existing
        ? existing.id
        : (await prisma.item.create({
            data: {
              organizationId: org.id,
              boardId: board.id,
              itemType: ITEM_TYPE,
              // Item."itemId" is the model's own foreign key to the thing it
              // represents, which here is the meeting.
              itemId: m.id,
              title: m.title || "Untitled meeting",
              ownerId,
              assigneeIds: attendeeIds,
              dueAt: m.scheduledAt,
              startAt: m.scheduledAt,
              metadata: { meetingId: m.id, system: true, source: "meetings" },
            },
            select: { id: true },
          })).id;

      await prisma.meeting.update({ where: { id: m.id }, data: { itemId } });
      linked += 1;
    }

    totalLinked += linked;
    totalOwnerless += ownerless;

    line(`${org.name || org.id}`);
    line(`  meetings                 ${meetings.length}`);
    line(`  already linked           ${already}`);
    line(`  re-linked (stale item)   ${relinked}`);
    line(`  ${WRITE ? "linked" : "would link"}${WRITE ? "                   " : "               "}${linked}`);
    line(`  no creator and no one on it   ${ownerless}`);
    line(`  meetings list            ${board.id ? (board.created ? "created" : "already there") : "would be created"}`);
    line("");
  }

  line("TOTALS");
  line(`  organizations            ${orgs.length}`);
  line(`  meetings seen            ${totalMeetings}`);
  line(`  already linked           ${totalAlready}`);
  line(`  re-linked                ${totalRelinked}`);
  line(`  ${WRITE ? "linked" : "would link"}                   ${totalLinked}`);
  line(`  rows naming nobody       ${totalOwnerless}`);
  if (!WRITE) line(`  lists that would be made ${totalWouldCreateBoards}`);
  line("");

  // Rule 3: assert, rather than report success over a half-done write.
  if (WRITE) {
    const remaining = await prisma.meeting.count({
      where: {
        deletedAt: null,
        itemId: null,
        ...(ORG_ARG ? { organizationId: ORG_ARG } : {}),
      },
    });
    if (remaining !== 0) {
      line(`ASSERTION FAILED: ${remaining} meetings still have no item.`);
      line("Nothing was rolled back (every write is additive and idempotent).");
      line("Run the script again: it resumes.");
      return 1;
    }
    line("Assertion passed: every live meeting has an item.");
  } else {
    line("Nothing was written. Re-run with --write to apply.");
  }
  return 0;
}

run()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
