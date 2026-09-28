// Phase 6: the escalation thresholds' reader, REPORT ONLY (spec-teams-people
// T9, PO-11). Thresholds on a job title are stored and never read; before
// any job escalates anything, the founder sees this report per organization:
// which thresholds exist, how many people hold each job title, who an
// escalation would go to (the threshold's escalatedToId, else each holder's
// manager, and how many holders have neither), and for the overdue-shaped
// triggers how many open items of those holders would have crossed the
// threshold in the last 30 days.
//
// NEVER WRITES, never notifies. The job that acts on it waits for founder
// approval (T9); until then the Thresholds card stays behind "Show upcoming
// features" with "Not enforced yet".
//
// Usage:
//   npx tsx scripts/report-escalation-thresholds.ts [--org=<id>] [--report=<file>]
//
// There is no --write flag: this reader has nothing to write. The counting
// rules (owner OR assignee, done items excluded, the crossing moment inside
// the 30-day window) live in src/lib/people/escalation-report.ts and are
// pinned by its tests. Items are read in id-cursor pages, so no org is cut
// off at a row cap.

import { writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import {
  isOverdueTrigger,
  thresholdDurationMs,
  unreachableHolders,
  wouldHaveEscalated,
  type ThresholdSummary,
} from "../src/lib/people/escalation-report";

loadEnv({ path: ".env.local" });
loadEnv();

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const arg = (name: string): string | null => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
};
const ORG = arg("org");
const REPORT = arg("report");
const PAGE = 2000;
const out: string[] = [];
const line = (s = "") => { out.push(s); process.stdout.write(`${s}\n`); };

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

/** Every open, dated item of these holders (owner or assignee) due inside the lookback, read in id-cursor pages. */
async function countWouldEscalate(orgId: string, holderIds: string[], ms: number, since: Date, now: Date): Promise<{ scanned: number; hits: number }> {
  const holderSet = new Set(holderIds);
  let cursor: string | null = null;
  let scanned = 0;
  let hits = 0;
  // An item crosses at dueAt + ms, so only items due in [since - ms, now - ms] can cross inside the window.
  const dueFrom = new Date(since.getTime() - ms);
  const dueTo = new Date(now.getTime() - ms);
  for (;;) {
    const page: { id: string; ownerId: string | null; assigneeIds: string[]; status: string | null; dueAt: Date | null }[] = await prisma.item.findMany({
      where: {
        organizationId: orgId,
        archivedAt: null,
        dueAt: { gte: dueFrom, lte: dueTo },
        OR: [{ ownerId: { in: holderIds } }, { assigneeIds: { hasSome: holderIds } }],
      },
      select: { id: true, ownerId: true, assigneeIds: true, status: true, dueAt: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    for (const it of page) {
      scanned += 1;
      if (wouldHaveEscalated(it, holderSet, ms, since, now)) hits += 1;
    }
    if (page.length < PAGE) break;
    cursor = page[page.length - 1].id;
  }
  assert(hits <= scanned, "hits never exceed the items scanned");
  return { scanned, hits };
}

async function main() {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  line(`Escalation thresholds: REPORT ONLY, nothing is written or sent · ${now.toISOString()}`);
  line(`Window: items whose threshold crossing fell between ${since.toISOString()} and ${now.toISOString()}`);
  const orgs = await prisma.organization.findMany({ where: ORG ? { id: ORG } : {}, select: { id: true, name: true }, orderBy: { name: "asc" } });
  let grandThresholds = 0;
  let grandHits = 0;
  for (const org of orgs) {
    const thresholds = await prisma.threshold.findMany({
      where: { organizationId: org.id },
      select: { id: true, label: true, trigger: true, value: true, unit: true, roleId: true, escalatedToId: true, role: { select: { title: true } } },
      orderBy: { createdAt: "asc" },
    });
    grandThresholds += thresholds.length;
    line("");
    line(`Organization ${org.name} (${org.id}) · ${thresholds.length} thresholds`);
    const matchedPeople = new Set<string>();
    let orgHits = 0;
    let orgUnreachable = 0;
    for (const t of thresholds) {
      // Threshold.roleId joins User.roleId: the people who hold the job title today (leavers excluded).
      const holders = t.roleId
        ? await prisma.user.findMany({ where: { organizationId: org.id, roleId: t.roleId, deletedAt: null }, select: { id: true, managerId: true } })
        : [];
      assert(new Set(holders.map((h) => h.id)).size === holders.length, "each holder is counted once per threshold");
      for (const h of holders) matchedPeople.add(h.id);
      const target = t.escalatedToId
        ? await prisma.user.findFirst({ where: { id: t.escalatedToId, organizationId: org.id, deletedAt: null }, select: { firstName: true, lastName: true } })
        : null;
      const summary: ThresholdSummary = { holders: holders.length, unreachable: unreachableHolders(t.escalatedToId, holders), wouldEscalate: null };
      const ms = thresholdDurationMs(t.value, t.unit);
      let scanned = 0;
      if (ms !== null && isOverdueTrigger(t.trigger) && holders.length > 0) {
        const r = await countWouldEscalate(org.id, holders.map((h) => h.id), ms, since, now);
        summary.wouldEscalate = r.hits;
        scanned = r.scanned;
      } else if (ms !== null && isOverdueTrigger(t.trigger)) {
        summary.wouldEscalate = 0;
      }
      orgHits += summary.wouldEscalate ?? 0;
      orgUnreachable += summary.unreachable;
      const targetText = t.escalatedToId
        ? target ? `${target.firstName} ${target.lastName}`.trim() : "a named person who is no longer in the organization (would reach nobody)"
        : "each holder's manager";
      line(`  ${t.label} · ${t.role?.title ?? "no job title (matches nobody)"} · trigger "${t.trigger}" ${t.value}${t.unit ? ` ${t.unit}` : ""}`);
      line(`    people matched ${summary.holders} · escalates to ${targetText}${summary.unreachable ? ` · ${summary.unreachable} holders with nobody to escalate to` : ""}`);
      line(summary.wouldEscalate === null
        ? "    trigger not measurable on Items yet (only overdue-shaped triggers with a duration unit are)"
        : `    ${summary.wouldEscalate} open items would have escalated in the last 30 days (${scanned} candidate items scanned)`);
    }
    line(`  Org total: ${matchedPeople.size} distinct people matched · ${orgHits} escalations in the last 30 days · ${orgUnreachable} unreachable holder slots`);
    grandHits += orgHits;
  }
  line("");
  line(`All organizations: ${orgs.length} · ${grandThresholds} thresholds · ${grandHits} escalations would have fired in the last 30 days`);
  line("Nothing was written. The escalation job waits for founder approval (spec-teams-people T9).");
}

main()
  .then(async () => { if (REPORT) writeFileSync(REPORT, `${out.join("\n")}\n`); await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
