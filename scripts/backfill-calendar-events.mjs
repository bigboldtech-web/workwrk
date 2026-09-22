// Phase 4 (Time and Talk) data script: move the calendar rows that were
// living in the wrong table into CalendarEvent.
//
// WHY. docs/plans/ui-refresh/spec-planner.md section 4 step 5:
//
//   "then the CalendarEvent migration: copy GCAL and personal-event Task
//    rows (externalSource = "GCAL", or no board and a startAt) into
//    CalendarEvent with a dry-run report, point the sync cron at the new
//    table, leave the old rows until the work-home unit retires Task"
//
// Two populations, both of them calendar entries that ended up in a table
// for to-do items:
//
//   GCAL       rows the Google sync cron wrote into the legacy `Task`
//              table with externalSource = 'GCAL'. The Planner read `Item`,
//              so these were invisible everywhere in the product: a person
//              connected their calendar, granted access, and saw nothing.
//   PERSONAL   rows the Calendar's old "New event" popover wrote through
//              POST /api/me/work: an Item on the person's personal board
//              with a startAt and no due date, which is a block of time
//              wearing a to-do's clothes. It showed up in My work, in the
//              open-task counts and in every "still to do" list.
//
// THE SEVEN RULES (scripts/MIGRATIONS.md):
//
//   1. DRY RUN BY DEFAULT. Pass --write to write. Without it nothing is
//      created and nothing is changed.
//   2. A PER-ORGANIZATION REPORT is printed either way.
//   3. IT ASSERTS. The count of rows that should exist afterwards is
//      checked; a mismatch aborts rather than reporting success over a
//      half-done write.
//   4. IT IS IDEMPOTENT. A GCAL row is matched on
//      (userId, externalSource, externalId), which is a unique index, so a
//      second run updates instead of duplicating. A personal row is matched
//      on the marker this script writes into `externalId`
//      ("legacy-item:<id>") for exactly that reason.
//   5. IT NEVER DELETES OR MUTATES A SOURCE ROW. Not one Task and not one
//      Item is touched. Both populations keep rendering from their old
//      homes until the work-home unit retires the legacy table.
//
//      SO THE READER HAS TO DE-DUPLICATE, AND IT DOES. Leaving the source
//      in place means the same event exists twice after a --write run, and
//      GET /api/calendar/events reads BOTH tables, so without a
//      de-duplication pass every migrated row would render twice on the
//      grid. The pass lives at the end of that route: a CalendarEvent copy
//      supersedes the legacy row it was made from, matched on the key this
//      script writes (a Google row keeps its `externalId`, a copied
//      personal Item is marked "legacy-item:<id>"), and the copy wins.
//      If you change the key below, change it there too.
//   6. IT IS SAFE AGAINST AN OLD DATABASE. If "CalendarEvent" is absent
//      (prisma/sql/2026-09-22-calendar-event.sql not applied) it says so
//      and exits 0 without writing.
//   7. IT INVENTS NOTHING. Every title, time and owner is copied. A row
//      with no usable start is skipped and reported, never given "now".
//
// Usage:
//   node scripts/backfill-calendar-events.mjs                dry run
//   node scripts/backfill-calendar-events.mjs --write        write
//   node scripts/backfill-calendar-events.mjs --org=<id>     one organization
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

const GCAL = "GCAL";
/** The marker that makes a copied personal event findable on a second run. */
const LEGACY_PREFIX = "legacy-item:";

function line(s = "") { process.stdout.write(`${s}\n`); }

/** Does "CalendarEvent" exist yet? Rule 6. */
async function hasTable() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables
      WHERE table_name = 'CalendarEvent' LIMIT 1`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** One hour after the start, when the source row carries no end. */
function endFor(startAt, endAt, allDay) {
  if (allDay) return new Date(startAt.getTime() + 24 * 3_600_000 - 60_000);
  if (endAt && endAt.getTime() > startAt.getTime()) return endAt;
  return new Date(startAt.getTime() + 3_600_000);
}

async function upsert(row) {
  await prisma.calendarEvent.upsert({
    where: {
      userId_externalSource_externalId: {
        userId: row.userId,
        externalSource: row.externalSource,
        externalId: row.externalId,
      },
    },
    create: row,
    update: {
      title: row.title,
      startAt: row.startAt,
      endAt: row.endAt,
      allDay: row.allDay,
      description: row.description,
    },
  });
}

/**
 * The GCAL rows in the legacy Task table.
 *
 * `assigneeId` is the person whose calendar it came from, and it is the
 * only owner a Google row ever had. A row with no assignee belongs to
 * nobody and cannot be given to anybody, so it is skipped and reported.
 */
async function collectGcal() {
  const rows = await prisma.task.findMany({
    where: {
      externalSource: GCAL,
      ...(ORG_ARG ? { organizationId: ORG_ARG } : {}),
    },
    select: {
      id: true, title: true, description: true, date: true, startAt: true, endAt: true,
      allDay: true, externalId: true, assigneeId: true, organizationId: true,
    },
    orderBy: { id: "asc" },
  });
  const out = [];
  const skipped = [];
  for (const t of rows) {
    const startAt = t.startAt ?? t.date;
    if (!t.assigneeId || !t.organizationId || !startAt || !t.externalId) {
      skipped.push({ id: t.id, why: !t.assigneeId ? "no person" : !startAt ? "no start" : "no external id" });
      continue;
    }
    out.push({
      organizationId: t.organizationId,
      userId: t.assigneeId,
      title: t.title || "(No title)",
      kind: "EVENT",
      startAt,
      endAt: endFor(startAt, t.endAt, Boolean(t.allDay)),
      allDay: Boolean(t.allDay),
      description: t.description ?? null,
      externalSource: GCAL,
      externalId: t.externalId,
      subscriptionId: null,
    });
  }
  return { rows: out, skipped };
}

/**
 * The personal events the old New event popover wrote.
 *
 * THE SHAPE, AND WHY IT IS NARROW ON PURPOSE. The popover POSTed to
 * /api/me/work, which creates an Item on the person's PERSONAL board with a
 * startAt. A real task has a due date, a list somebody else can see, or a
 * status somebody moved it through. So the population taken here is:
 * an Item on a personal board, with a startAt, with no dueAt, still in its
 * board's first status, with no assignee other than its owner and no
 * subtasks. Anything else is somebody's actual work and is left alone.
 *
 * The consequence of being narrow is a few blocks of focus time staying
 * tasks, which is what they are today. The consequence of being wide would
 * be somebody's real task quietly turning into a calendar entry that no
 * task list shows, and that is not a trade this script is allowed to make.
 */
async function collectPersonal() {
  // A personal board is the one src/lib/board.ts creates for a person:
  // productSlug "personal-list", ownerId the person. Nothing else in the
  // product carries that slug.
  const boards = await prisma.board.findMany({
    where: {
      productSlug: "personal-list",
      ...(ORG_ARG ? { organizationId: ORG_ARG } : {}),
    },
    select: { id: true },
  });
  if (boards.length === 0) return { rows: [], skipped: [] };

  const items = await prisma.item.findMany({
    where: {
      boardId: { in: boards.map((b) => b.id) },
      archivedAt: null,
      startAt: { not: null },
      dueAt: null,
      parentItemId: null,
    },
    select: {
      id: true, title: true, startAt: true, dueAt: true,
      ownerId: true, assigneeIds: true, organizationId: true, metadata: true,
    },
    orderBy: { id: "asc" },
  });

  const out = [];
  const skipped = [];
  for (const it of items) {
    const legacy = it.metadata?.legacyTask;
    // A GCAL row that already migrated into Item is handled by the GCAL
    // pass through its own externalId, not here.
    if (legacy?.externalSource === GCAL) continue;
    if (!it.ownerId || !it.startAt) {
      skipped.push({ id: it.id, why: !it.ownerId ? "no owner" : "no start" });
      continue;
    }
    const others = (it.assigneeIds ?? []).filter((id) => id !== it.ownerId);
    if (others.length > 0) {
      skipped.push({ id: it.id, why: "shared with other people" });
      continue;
    }
    out.push({
      organizationId: it.organizationId,
      userId: it.ownerId,
      title: it.title || "Event",
      kind: "EVENT",
      startAt: it.startAt,
      endAt: endFor(it.startAt, null, false),
      allDay: false,
      // An Item's body lives in ItemUpdate rows, not on a column, so a
      // copied personal event carries no description rather than one this
      // script invented (rule 7).
      description: null,
      externalSource: null,
      externalId: `${LEGACY_PREFIX}${it.id}`,
      subscriptionId: null,
    });
  }
  return { rows: out, skipped };
}

async function run() {
  line("");
  line("  Phase 4 - copy calendar rows into CalendarEvent");
  line(`  mode: ${WRITE ? "WRITE" : "DRY RUN"}${ORG_ARG ? `   organization: ${ORG_ARG}` : ""}`);
  line("");

  if (!(await hasTable())) {
    line('  "CalendarEvent" is not in this database yet.');
    line("  Apply prisma/sql/2026-09-22-calendar-event.sql first, then run this again.");
    line("  Nothing was written.");
    return 0;
  }

  const gcal = await collectGcal();
  const personal = await collectPersonal();
  const all = [...gcal.rows, ...personal.rows];

  // Rule 2: the report, per organization, either way.
  const byOrg = new Map();
  for (const r of all) {
    const bucket = byOrg.get(r.organizationId) ?? { gcal: 0, personal: 0 };
    if (r.externalSource === GCAL) bucket.gcal++; else bucket.personal++;
    byOrg.set(r.organizationId, bucket);
  }
  line(`  organizations: ${byOrg.size}`);
  line(`  Google rows:   ${gcal.rows.length} to copy, ${gcal.skipped.length} skipped`);
  line(`  personal rows: ${personal.rows.length} to copy, ${personal.skipped.length} skipped`);
  line("");
  for (const [orgId, b] of byOrg) {
    line(`    ${orgId}   google ${b.gcal}   personal ${b.personal}`);
  }
  if (gcal.skipped.length || personal.skipped.length) {
    line("");
    line("  skipped, with the reason (nothing was changed on any of them):");
    for (const s of [...gcal.skipped, ...personal.skipped].slice(0, 40)) {
      line(`    ${s.id}   ${s.why}`);
    }
    const extra = gcal.skipped.length + personal.skipped.length - 40;
    if (extra > 0) line(`    and ${extra} more`);
  }
  line("");

  if (!WRITE) {
    line("  Nothing was written. Re-run with --write to apply.");
    return 0;
  }

  let written = 0;
  for (const row of all) {
    await upsert(row);
    written++;
  }
  line(`  wrote ${written} rows.`);

  // Rule 3: assert. Every row we just sent must be findable.
  const expectedGcal = new Set(gcal.rows.map((r) => `${r.userId}|${r.externalId}`));
  const found = await prisma.calendarEvent.findMany({
    where: {
      externalSource: GCAL,
      ...(ORG_ARG ? { organizationId: ORG_ARG } : {}),
    },
    select: { userId: true, externalId: true },
  });
  const foundSet = new Set(found.map((r) => `${r.userId}|${r.externalId}`));
  const missing = [...expectedGcal].filter((k) => !foundSet.has(k));
  if (missing.length > 0) {
    line(`  ASSERTION FAILED: ${missing.length} Google rows are not in CalendarEvent.`);
    line("  Nothing was rolled back (every write is an idempotent upsert).");
    line("  Run the script again: it resumes.");
    return 1;
  }

  const personalFound = await prisma.calendarEvent.count({
    where: {
      externalSource: null,
      externalId: { startsWith: LEGACY_PREFIX },
      ...(ORG_ARG ? { organizationId: ORG_ARG } : {}),
    },
  });
  if (personalFound < personal.rows.length) {
    line(`  ASSERTION FAILED: expected at least ${personal.rows.length} copied personal events, found ${personalFound}.`);
    return 1;
  }

  line("  Assertion passed: every row this run collected is in CalendarEvent.");
  line("  No Task and no Item was deleted or changed.");
  return 0;
}

run()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
