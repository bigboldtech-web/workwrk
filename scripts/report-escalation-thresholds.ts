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

import { writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";

loadEnv({ path: ".env.local" });
loadEnv();

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const arg = (name: string): string | null => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
};
const ORG = arg("org");
const REPORT = arg("report");
const out: string[] = [];
const line = (s = "") => { out.push(s); process.stdout.write(`${s}\n`); };

/** The threshold value in milliseconds, when its unit is a duration. */
function durationMs(value: number, unit: string | null): number | null {
  const u = (unit ?? "").toLowerCase();
  if (u.startsWith("min")) return value * 60_000;
  if (u.startsWith("h")) return value * 3_600_000;
  if (u.startsWith("d")) return value * 86_400_000;
  return null;
}

async function main() {
  line(`Escalation thresholds: REPORT ONLY, nothing is written or sent · ${new Date().toISOString()}`);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const orgs = await prisma.organization.findMany({ where: ORG ? { id: ORG } : {}, select: { id: true, name: true }, orderBy: { name: "asc" } });
  for (const org of orgs) {
    const thresholds = await prisma.threshold.findMany({
      where: { organizationId: org.id },
      select: { id: true, label: true, trigger: true, value: true, unit: true, roleId: true, escalatedToId: true, role: { select: { title: true } } },
    });
    line("");
    line(`Organization ${org.name} (${org.id}) · ${thresholds.length} thresholds`);
    for (const t of thresholds) {
      const holders = t.roleId
        ? await prisma.user.findMany({ where: { organizationId: org.id, roleId: t.roleId, deletedAt: null }, select: { id: true, managerId: true } })
        : [];
      const noTarget = t.escalatedToId ? 0 : holders.filter((h) => !h.managerId).length;
      let wouldEscalate: string = "trigger not measurable yet";
      const ms = durationMs(t.value, t.unit);
      if (ms !== null && /overdue|due|late/i.test(t.trigger) && holders.length > 0) {
        const n = await prisma.item.count({
          where: {
            organizationId: org.id,
            ownerId: { in: holders.map((h) => h.id) },
            archivedAt: null,
            dueAt: { gte: since, lt: new Date(Date.now() - ms) },
          },
        });
        wouldEscalate = `${n} items overdue past the threshold in the last 30 days (done status not excluded; an upper bound)`;
      }
      line(`  ${t.label} · ${t.role?.title ?? "no job title"} · trigger "${t.trigger}" ${t.value}${t.unit ? ` ${t.unit}` : ""}`);
      line(`    holders ${holders.length} · target ${t.escalatedToId ? "a named person" : "each holder's manager"}${noTarget ? ` · ${noTarget} holders with nobody to escalate to` : ""}`);
      line(`    ${wouldEscalate}`);
    }
  }
}

main()
  .then(async () => { if (REPORT) writeFileSync(REPORT, `${out.join("\n")}\n`); await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
