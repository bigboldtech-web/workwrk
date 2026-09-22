// Phase 4 (Time and Talk) data script: give every historical Meeting a creator.
//
// WHY. spec-planner.md section 1 Access says "the creator is createdById
// (rule 5 = FULL)". Until 2026-09-22-time-and-talk.sql the Meeting table had
// no creator column at all, so every meeting written before today has
// createdById = NULL and cannot answer "who owns this meeting". The API
// tolerates NULL (it falls back to "an attendee, or an Owner or Admin"), so
// this script is a quality improvement, not a prerequisite.
//
// THE RULE, in the order it is applied:
//
//   1. THE ACTIVITY LOG, which is the only RECORD of who created the
//      meeting rather than a guess about it. POST /api/meetings has always
//      written `logActivity({ type: "meeting_created", actorId, targetId:
//      meeting.id, targetType: "meeting" })`, so for every meeting created
//      through the product the true creator is sitting in ActivityLog. The
//      earliest such row wins (a meeting is created once; a duplicate row
//      would be a replay).
//
//   2. THE SOLE ATTENDEE. If the log has nothing and the meeting has
//      exactly ONE attendee, that person is the creator by elimination:
//      the meeting exists, somebody made it, and only one person is on it.
//
//   3. Everything else is LEFT NULL and reported.
//
// WHAT IS DELIBERATELY NOT A RULE ANY MORE.
//
//   "the earliest attendee" on a meeting with several. MeetingAttendee has
//   no createdAt and every attendee of a historical meeting was written in
//   ONE createMany batch at meeting creation, so the lowest cuid is
//   whoever happened to sit first in the picker array, not the person who
//   scheduled it. Ordering inside a single batch carries no information.
//
//   "else the first Owner of the organization". createdById is the FULL
//   role in src/lib/meeting-access.ts: it is the only role that can delete
//   the meeting. Handing that to an admin who never scheduled it is
//   inventing an owner, which rule 7 below forbids, and it buys nothing:
//   Owners and Admins already read and manage every meeting in the org
//   through the isOrgAdmin branch, so a row left NULL is not a row that
//   becomes unreachable.
//
// THE SEVEN RULES THIS SCRIPT FOLLOWS
//   1. Dry run by default. --write is the only thing that writes.
//   2. Prints a per-organization report before it writes anything.
//   3. Asserts its own counts and exits non zero when they disagree.
//   4. Idempotent: only rows with createdById = NULL are considered.
//   5. Never deletes and never mutates a source row. The only column it
//      writes is the new nullable one.
//   6. Reads nothing outside Meeting, MeetingAttendee and ActivityLog.
//   7. A row it cannot resolve is reported, not invented.
//
// Usage:
//   node scripts/backfill-meeting-created-by.mjs               # report only
//   node scripts/backfill-meeting-created-by.mjs --write       # apply
//   node scripts/backfill-meeting-created-by.mjs --org=<id>    # one org

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const write = process.argv.includes("--write");
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const onlyOrg = orgArg ? orgArg.split("=")[1] : null;

function line(s) { process.stdout.write(`${s}\n`); }

async function main() {
  line(`meeting createdById backfill: ${write ? "WRITE" : "dry run"}`);
  line("");

  const meetings = await prisma.meeting.findMany({
    where: {
      createdById: null,
      ...(onlyOrg ? { organizationId: onlyOrg } : {}),
    },
    select: {
      id: true,
      title: true,
      organizationId: true,
      attendees: { select: { id: true, userId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (meetings.length === 0) {
    line("Nothing to do: every meeting already has a creator.");
    await prisma.$disconnect();
    return;
  }

  // Rule 1: the meeting_created activity rows for exactly these meetings.
  // One query for the whole batch, oldest first, so the first row seen for
  // an id is the earliest one and later rows are ignored.
  const createdBy = new Map();
  const ids = meetings.map((m) => m.id);
  for (let i = 0; i < ids.length; i += 500) {
    const logs = await prisma.activityLog.findMany({
      where: { targetType: "meeting", type: "meeting_created", targetId: { in: ids.slice(i, i + 500) } },
      select: { targetId: true, actorId: true, organizationId: true },
      orderBy: { createdAt: "asc" },
    });
    for (const l of logs) {
      if (!l.targetId || createdBy.has(l.targetId)) continue;
      createdBy.set(l.targetId, { actorId: l.actorId, organizationId: l.organizationId });
    }
  }

  const plan = [];
  const byOrg = new Map();
  for (const m of meetings) {
    const logged = createdBy.get(m.id);
    // An activity row from another organization is not evidence about this
    // meeting: cross-org ids are the one way a log lookup can go wrong, and
    // writing that actor in would leak the row to a stranger.
    const fromLog = logged && logged.organizationId === m.organizationId ? logged.actorId : null;
    const soleAttendee = m.attendees.length === 1 ? m.attendees[0].userId : null;
    const userId = fromLog ?? soleAttendee ?? null;
    const source = fromLog ? "log" : soleAttendee ? "sole" : "unresolved";
    plan.push({ id: m.id, title: m.title, orgId: m.organizationId, userId, source });
    const bucket = byOrg.get(m.organizationId) ?? { log: 0, sole: 0, unresolved: 0 };
    bucket[source] += 1;
    byOrg.set(m.organizationId, bucket);
  }

  line("Per organization");
  line("org                                  from log  sole attendee  unresolved");
  for (const [orgId, b] of byOrg) {
    line(`${orgId.padEnd(36)} ${String(b.log).padStart(8)} ${String(b.sole).padStart(14)} ${String(b.unresolved).padStart(11)}`);
  }
  line("");

  const resolvable = plan.filter((p) => p.userId);
  const unresolved = plan.filter((p) => !p.userId);
  line(`Total meetings with no creator: ${plan.length}`);
  line(`  resolvable: ${resolvable.length}`);
  line(`  left NULL:  ${unresolved.length}`);
  if (unresolved.length > 0) {
    line("");
    line("Left NULL (no meeting_created activity row, and not a single");
    line("attendee meeting, so the creator is not recorded anywhere):");
    for (const p of unresolved.slice(0, 25)) line(`  ${p.id}  ${p.title}`);
    if (unresolved.length > 25) line(`  ... and ${unresolved.length - 25} more`);
    line("");
    line("These rows are NOT lost. Owners and Admins read and manage every");
    line("meeting in the organization, so an Owner can open one, add the");
    line("people who belong on it, and it resolves for them from then on.");
  }

  if (!write) {
    line("");
    line("Dry run. Re-run with --write to apply.");
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const p of resolvable) {
    // The WHERE keeps it idempotent even under a concurrent run.
    const res = await prisma.meeting.updateMany({
      where: { id: p.id, createdById: null },
      data: { createdById: p.userId },
    });
    written += res.count;
  }

  line("");
  line(`Wrote ${written} of ${resolvable.length} resolvable rows.`);

  const stillNull = await prisma.meeting.count({
    where: { createdById: null, ...(onlyOrg ? { organizationId: onlyOrg } : {}) },
  });
  line(`Meetings still without a creator: ${stillNull} (expected ${unresolved.length})`);

  if (stillNull !== unresolved.length) {
    line("ASSERTION FAILED: the remaining-null count does not match the plan.");
    await prisma.$disconnect();
    process.exit(1);
  }
  line("Counts agree.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
