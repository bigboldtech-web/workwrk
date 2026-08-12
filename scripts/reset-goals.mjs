// DESTRUCTIVE: wipe the goals layer (OKRs, their key results and check-ins,
// plus department goals) so goals can be rebuilt on the new audience model.
//
// EXPLICITLY OUT OF SCOPE — never touched, and asserted afterwards:
//   • SOPs and SOP assignments. Goals have no link to them at all; the
//     script counts them before and after and aborts if either moved.
//   • KRAs, KPIs and KPI history. KeyResult.kpiId is ON DELETE SET NULL on
//     the KPI side, so deleting a key result cannot disturb a KPI. Counts
//     are asserted the same way.
//   • Roles, people, tasks, boards, docs, everything else.
//
// What goes (children first, though the FKs cascade anyway):
//   • KRCheckIn   (cascades from KeyResult)
//   • KeyResult   (cascades from OKR)
//   • OKR         (the whole goal tree for the org, parents included)
//   • DepartmentGoal for departments in this org
//
// A full JSON backup of everything deleted is written BEFORE any delete,
// so the wipe is recoverable.
//
//   node scripts/reset-goals.mjs --org <orgId>            # dry run
//   node scripts/reset-goals.mjs --org <orgId> --commit
//   …--keep-department-goals    (leave DepartmentGoal rows alone)
//
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const COMMIT = argv.includes("--commit");
const KEEP_DEPT_GOALS = argv.includes("--keep-department-goals");
const ORG = flag("--org");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!ORG) { console.error("--org <organizationId> is required (refusing to run org-wide)."); process.exit(1); }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  console.log(COMMIT ? "MODE: COMMIT — this deletes data" : "MODE: DRY RUN (no writes — add --commit to apply)");

  const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { id: true, name: true } });
  if (!org) { console.error("Organization not found."); process.exit(1); }
  console.log(`Organization: ${org.name}\n`);

  // ---- what we're about to remove ------------------------------------
  const okrs = await prisma.oKR.findMany({
    where: { organizationId: ORG },
    include: { keyResults: { include: { checkIns: true } } },
  });
  const okrIds = okrs.map((o) => o.id);
  const krIds = okrs.flatMap((o) => o.keyResults.map((k) => k.id));
  const checkInCount = okrs.reduce((s, o) => s + o.keyResults.reduce((t, k) => t + k.checkIns.length, 0), 0);

  const deptGoals = KEEP_DEPT_GOALS
    ? []
    : await prisma.departmentGoal.findMany({ where: { department: { organizationId: ORG } } });

  console.log("To delete:");
  console.log(`  OKRs ...................... ${okrs.length}`);
  console.log(`  Key results ............... ${krIds.length}`);
  console.log(`  Check-ins ................. ${checkInCount}`);
  console.log(`  Department goals .......... ${deptGoals.length}${KEEP_DEPT_GOALS ? "  (kept by flag)" : ""}`);

  // ---- the things that must not move ---------------------------------
  const before = await counts();
  console.log("\nMust be untouched:");
  console.log(`  SOPs ...................... ${before.sop}`);
  console.log(`  SOP assignments ........... ${before.sopAssignment}`);
  console.log(`  KRAs ...................... ${before.kra}`);
  console.log(`  KPIs ...................... ${before.kpi}`);
  console.log(`  KPI records ............... ${before.kpiRecord}`);

  if (okrs.length === 0 && deptGoals.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }
  if (!COMMIT) {
    console.log("\nDry run only. Re-run with --commit to apply.");
    return;
  }

  // ---- backup before touching anything -------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `/tmp/workwrk-goals-backup-${stamp}.json`;
  writeFileSync(path, JSON.stringify({ org, okrs, deptGoals }, null, 2));
  console.log(`\nBackup written: ${path}`);

  // ---- delete, children first ----------------------------------------
  if (krIds.length) {
    const ci = await prisma.kRCheckIn.deleteMany({ where: { keyResultId: { in: krIds } } });
    console.log(`  deleted check-ins ......... ${ci.count}`);
    const kr = await prisma.keyResult.deleteMany({ where: { id: { in: krIds } } });
    console.log(`  deleted key results ....... ${kr.count}`);
  }
  if (okrIds.length) {
    // Clear parent pointers first so a self-referential FK can't block us.
    await prisma.oKR.updateMany({ where: { id: { in: okrIds } }, data: { parentId: null } });
    const o = await prisma.oKR.deleteMany({ where: { id: { in: okrIds } } });
    console.log(`  deleted OKRs .............. ${o.count}`);
  }
  if (deptGoals.length) {
    const d = await prisma.departmentGoal.deleteMany({ where: { id: { in: deptGoals.map((g) => g.id) } } });
    console.log(`  deleted department goals .. ${d.count}`);
  }

  // ---- assert nothing else moved --------------------------------------
  const after = await counts();
  const drift = Object.keys(before).filter((k) => before[k] !== after[k]);
  if (drift.length) {
    console.error(`\n!! COLLATERAL CHANGE in: ${drift.map((k) => `${k} ${before[k]} → ${after[k]}`).join(", ")}`);
    console.error(`Restore from ${path} immediately.`);
    process.exit(1);
  }
  console.log("\nVerified: SOPs, SOP assignments, KRAs, KPIs and KPI history all unchanged.");
}

async function counts() {
  const [sop, sopAssignment, kra, kpi, kpiRecord] = await Promise.all([
    prisma.sOP.count({ where: { organizationId: ORG } }),
    prisma.sOPAssignment.count({ where: { sop: { organizationId: ORG } } }),
    prisma.kRA.count({ where: { organizationId: ORG } }),
    prisma.kPI.count({ where: { organizationId: ORG } }),
    prisma.kPIRecord.count({ where: { kpi: { organizationId: ORG } } }),
  ]);
  return { sop, sopAssignment, kra, kpi, kpiRecord };
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
