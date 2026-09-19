/**
 * migrate-notification-types.ts — lowercase the four SCREAMING_CASE values in
 * `Notification.type`, plus the two two-word ones.
 *
 * Spec: docs/plans/ui-refresh/spec-work-home.md section 4, data migration 1.
 *
 * WHY. `Notification.type` is an unconstrained String written from twenty-
 * seven sites in three casing conventions. `src/lib/inbox-kinds.ts` is the one
 * routing table over it, and the Inbox, the bell and the sidebar badge all
 * read tabs and counts through it with a SQL `type IN (…)` list. An uppercase
 * row does not match that list, so before this runs those rows are routed by
 * `TYPE_ALIASES` on the read side only — correct in the pane, invisible to the
 * `IN` list the counts use.
 *
 * ORDER MATTERS. The write-time fix (every writer now stores the lowercase
 * form) ships FIRST, in the same release as this script. Running the script
 * before that lands means the next kudos written puts an uppercase row back,
 * and the script has to be run forever.
 *
 * SAFETY. It is a pure rename of a routing key. It never deletes a row, never
 * changes who a notification belongs to, and never changes its title, message
 * or link. It is idempotent by construction: a second run matches nothing.
 * `TYPE_ALIASES` stays in the code permanently afterwards, so a row this script
 * never reached (a replica, a restored backup) still routes correctly.
 *
 * Usage — see scripts/MIGRATIONS.md for the approval gate.
 *
 *   npx tsx scripts/migrate-notification-types.ts                      # dry run
 *   npx tsx scripts/migrate-notification-types.ts --report /tmp/r.json # dry run, saved
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/migrate-notification-types.ts --write            # LOCAL only
 */

import fs from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";

const prisma = scriptPrisma();

/** The rename map. Keys are what is stored; values are what inbox-kinds uses. */
const RENAMES: Record<string, string> = {
  KUDOS: "kudos",
  SURVEY: "survey",
  REVIEW: "review",
  POLICY: "policy",
  SOP: "sop",
  TASK_ESCALATED: "task_escalated",
};

interface Report {
  ranAt: string;
  /** Which database this ran against, without the password. */
  database: string;
  write: boolean;
  /** Per stored type: how many rows carry it, and how many were rewritten. */
  types: Array<{ from: string; to: string; read: number; written: number }>;
  totalRead: number;
  totalWritten: number;
  /** Types the routing table does not know, so somebody can decide about them. */
  unroutedTypes: Array<{ type: string; count: number }>;
  /** How many organizations got an ActivityLog record of this run (rule 7). */
  orgsLogged?: number;
}

async function main() {
  const write = process.argv.includes("--write");
  const reportAt = argValue("--report");

  const report: Report = {
    ranAt: new Date().toISOString(),
    database: databaseLabel(),
    write,
    types: [],
    totalRead: 0,
    totalWritten: 0,
    unroutedTypes: [],
  };

  // Notification has no organizationId (the model predates org scoping), so
  // "per org" is not expressible here and the rule is satisfied differently:
  // the change is a value rename with no cross-row dependency, so there is
  // nothing a per-org transaction could keep consistent that a single
  // statement does not. It is still one statement per type, so a failure on
  // the third type leaves the first two correctly renamed and re-running
  // finishes the job.
  for (const [from, to] of Object.entries(RENAMES)) {
    const read = await prisma.notification.count({ where: { type: from } });
    report.totalRead += read;
    let written = 0;
    if (write && read > 0) {
      const r = await prisma.notification.updateMany({ where: { type: from }, data: { type: to } });
      written = r.count;
      // Row-count assertion: every row read must be a row written.
      if (written !== read) {
        throw new Error(`Assertion failed for "${from}": read ${read}, wrote ${written}. Nothing else was touched.`);
      }
      report.totalWritten += written;
    }
    report.types.push({ from, to, read, written });
  }

  // Rule 7 (scripts/MIGRATIONS.md): the report is archived IN THE PRODUCT, not
  // only in a file, so there is a record of what moved and when.
  //
  // Notification has no organizationId, so the rename itself is global; the
  // record is not. The affected rows are read back through their owners into a
  // per-org tally, and each org gets one ActivityLog row carrying ITS OWN
  // numbers. A global count stamped on every org would be a record that says
  // something untrue about most of them.
  if (write && report.totalWritten > 0) {
    report.orgsLogged = await archivePerOrg(Object.values(RENAMES), report);
  }

  // What is left that inbox-kinds does not route. Not changed by this script:
  // it is information for whoever decides whether a new kind is needed.
  const grouped = await prisma.notification.groupBy({ by: ["type"], _count: { _all: true } });
  const { KINDS, normaliseNotificationType } = await import("../src/lib/inbox-kinds");
  for (const row of grouped) {
    const normalised = normaliseNotificationType(row.type);
    if (!KINDS[normalised]) report.unroutedTypes.push({ type: row.type, count: row._count._all });
  }
  report.unroutedTypes.sort((a, b) => b.count - a.count);

  print(report);
  if (reportAt) {
    fs.writeFileSync(reportAt, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to ${reportAt}`);
  }
  if (!write) {
    console.log("\nDRY RUN. Nothing was written. Add --write to apply (see scripts/MIGRATIONS.md).");
  }
}

/**
 * One ActivityLog row per organization whose people were affected.
 *
 * Read AFTER the rename, by the NEW type values, so the per-org number is
 * "how many of this workspace's rows carry a normalised key", not "how many
 * this run moved" (which is global, and is in the row too). It is
 * idempotent-safe: a second run renames nothing, `totalWritten` is 0 and this
 * never fires, so no org collects a second row for a migration that did
 * nothing. Best effort throughout: the JSON report is the other copy of the
 * record, and an ActivityLog shape this row does not fit must not turn a
 * completed, correct rename into a failure.
 */
async function archivePerOrg(newTypes: string[], report: Report): Promise<number> {
  const rows = await prisma.notification.findMany({
    where: { type: { in: newTypes } },
    select: { user: { select: { organizationId: true } } },
    // Bounded: these are the six legacy uppercase kinds, not the whole table.
    take: 50_000,
  });
  const perOrg = new Map<string, number>();
  for (const r of rows) {
    const org = r.user?.organizationId;
    if (!org) continue;
    perOrg.set(org, (perOrg.get(org) ?? 0) + 1);
  }
  let logged = 0;
  for (const [organizationId, count] of perOrg) {
    // ActivityLog needs an actor and a migration has no person behind it, so
    // the org's first admin stands in and the description says plainly that it
    // was a migration rather than something they did.
    const actor = await prisma.user
      .findFirst({
        where: { organizationId, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      })
      .catch(() => null);
    if (!actor) continue;
    const ok = await prisma.activityLog
      .create({
        data: {
          organizationId,
          actorId: actor.id,
          type: "work.notification_types_normalised",
          targetType: "notification",
          targetId: organizationId,
          description:
            `Notification type normalisation ran. ${report.totalWritten} row(s) were rewritten across all workspaces; ` +
            `${count} notification(s) in this workspace carry a normalised routing key as a result of this run and earlier ones.`,
          metadata: {
            rowsCarryingNormalisedTypeInThisOrg: count,
            totalRewrittenGlobally: report.totalWritten,
            renames: report.types.filter((t) => t.written > 0).map((t) => `${t.from} -> ${t.to}`),
            ranAt: report.ranAt,
          },
        },
      })
      .then(() => true)
      .catch(() => false);
    if (ok) logged += 1;
  }
  return logged;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function print(report: Report) {
  console.log(`\nNotification type normalisation — ${report.write ? "WRITE" : "dry run"}`);
  console.log(`Database: ${report.database}\n`);
  console.log("  stored type        ->  routed type        rows   written");
  for (const t of report.types) {
    console.log(`  ${t.from.padEnd(18)} ->  ${t.to.padEnd(18)} ${String(t.read).padStart(5)}   ${String(t.written).padStart(7)}`);
  }
  console.log(`\n  total rows matching a rename: ${report.totalRead}`);
  console.log(`  total rows rewritten:         ${report.totalWritten}`);
  if (typeof report.orgsLogged === "number") {
    console.log(`  workspaces given an ActivityLog record: ${report.orgsLogged}`);
  }
  if (report.unroutedTypes.length) {
    console.log(`\n  Types with no row in inbox-kinds.ts (left alone; these render with the`);
    console.log(`  fallback kind, which is readable but generic):`);
    for (const u of report.unroutedTypes) console.log(`    ${u.type.padEnd(30)} ${u.count}`);
  } else {
    console.log("\n  Every stored type is routed by inbox-kinds.ts.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
