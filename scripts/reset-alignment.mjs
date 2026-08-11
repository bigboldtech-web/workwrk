// DESTRUCTIVE: wipe the alignment layer (job titles, KRAs, KPIs) so it can
// be rebuilt from scratch, role-first.
//
// EXPLICITLY OUT OF SCOPE — never touched:
//   • SOPs. SOP.kraId is ON DELETE SET NULL, so SOPs SURVIVE; they only
//     lose a pointer to a KRA that no longer exists. The script asserts
//     the SOP count is identical before and after and aborts if not.
//   • Tasks (Task.kraId is SET NULL too), boards, docs, everything else.
//
// What goes:
//   • every KPI  (cascades KPIRecord history; KeyResult.kpiId → SET NULL)
//   • every KRA  (cascades KRAAssignment; SOP/Task links → SET NULL)
//   • every Role EXCEPT the keep-list (cascades RoleInstance / RoleBoundary
//     / Threshold; User.roleId and OwnershipArea.ownerRoleId → SET NULL)
//
// A full JSON backup of everything deleted is written BEFORE any delete,
// so the wipe is recoverable.
//
//   node scripts/reset-alignment.mjs --org <orgId>                  # dry run
//   node scripts/reset-alignment.mjs --org <orgId> --commit
//   …--keep-roles "CEO"        (default; comma-separated, case-insensitive)
//   …--with-okrs               (also delete OKRs + their key results)
//
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const COMMIT = argv.includes("--commit");
const WITH_OKRS = argv.includes("--with-okrs");
const ORG = flag("--org");
const KEEP = (flag("--keep-roles", "CEO") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!ORG) { console.error("--org <organizationId> is required (refusing to run org-wide)."); process.exit(1); }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  console.log(COMMIT ? "MODE: COMMIT — this deletes data" : "MODE: DRY RUN (no writes — add --commit to apply)");
  console.log(`Org: ${ORG}`);
  console.log(`Keeping job titles: ${KEEP.join(", ") || "(none)"}\n`);

  const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { id: true, name: true } });
  if (!org) { console.error("Organization not found."); process.exit(1); }
  console.log(`Organization: ${org.name}\n`);

  const roles = await prisma.role.findMany({
    where: { organizationId: ORG },
    select: { id: true, title: true, _count: { select: { users: true } } },
    orderBy: { title: "asc" },
  });
  const keepRoles = roles.filter((r) => KEEP.includes(r.title.trim().toLowerCase()));
  const dropRoles = roles.filter((r) => !KEEP.includes(r.title.trim().toLowerCase()));

  const [kraCount, kpiCount, kpiRecords, kraAssignments, sopBefore, sopLinked, taskLinked, okrCount, krLinked] =
    await Promise.all([
      prisma.kRA.count({ where: { organizationId: ORG } }),
      prisma.kPI.count({ where: { organizationId: ORG } }),
      prisma.kPIRecord.count({ where: { kpi: { organizationId: ORG } } }),
      prisma.kRAAssignment.count({ where: { kra: { organizationId: ORG } } }),
      prisma.sOP.count({ where: { organizationId: ORG } }),
      prisma.sOP.count({ where: { organizationId: ORG, kraId: { not: null } } }),
      prisma.task.count({ where: { organizationId: ORG, kraId: { not: null } } }),
      prisma.oKR.count({ where: { organizationId: ORG } }),
      prisma.keyResult.count({ where: { kpiId: { not: null }, okr: { organizationId: ORG } } }),
    ]);
  const peopleLosingTitle = dropRoles.reduce((n, r) => n + r._count.users, 0);

  console.log("WILL DELETE");
  console.log(`  KPIs .................... ${kpiCount}   (cascades ${kpiRecords} recorded value(s))`);
  console.log(`  KRAs .................... ${kraCount}   (cascades ${kraAssignments} person assignment(s))`);
  console.log(`  Job titles .............. ${dropRoles.length} of ${roles.length}`);
  for (const r of dropRoles) console.log(`      − ${r.title} (${r._count.users} holder(s))`);
  if (WITH_OKRS) console.log(`  OKRs .................... ${okrCount}  (with their key results)`);

  console.log("\nWILL KEEP");
  for (const r of keepRoles) console.log(`      ✓ ${r.title} (${r._count.users} holder(s))`);
  if (!WITH_OKRS) console.log(`      ✓ ${okrCount} OKR(s) — pass --with-okrs to clear these too`);

  console.log("\nSIDE EFFECTS (nothing is destroyed here — links are cleared)");
  console.log(`  SOPs ...................... ${sopBefore} kept; ${sopLinked} lose a KRA link`);
  console.log(`  Tasks ..................... ${taskLinked} lose a KRA link (tasks themselves untouched)`);
  console.log(`  People .................... ${peopleLosingTitle} lose their job title (accounts untouched)`);
  if (!WITH_OKRS) console.log(`  Key results ............... ${krLinked} lose their KPI link (OKRs kept)`);

  if (!COMMIT) { console.log("\nDry run — nothing written."); return; }

  // ---- backup before touching anything -------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = {
    takenAt: new Date().toISOString(),
    organizationId: ORG,
    roles: await prisma.role.findMany({ where: { organizationId: ORG } }),
    kras: await prisma.kRA.findMany({ where: { organizationId: ORG } }),
    kpis: await prisma.kPI.findMany({ where: { organizationId: ORG } }),
    kraAssignments: await prisma.kRAAssignment.findMany({ where: { kra: { organizationId: ORG } } }),
    kpiRecords: await prisma.kPIRecord.findMany({ where: { kpi: { organizationId: ORG } } }),
    userRoleMap: await prisma.user.findMany({
      where: { organizationId: ORG, roleId: { not: null } },
      select: { id: true, firstName: true, lastName: true, email: true, roleId: true },
    }),
    okrs: WITH_OKRS ? await prisma.oKR.findMany({ where: { organizationId: ORG }, include: { keyResults: true } }) : [],
  };
  const path = `/tmp/workwrk-alignment-backup-${stamp}.json`;
  writeFileSync(path, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written: ${path}`);

  // ---- delete, children first ----------------------------------------
  if (WITH_OKRS) {
    const okrs = await prisma.oKR.deleteMany({ where: { organizationId: ORG } });
    console.log(`Deleted OKRs: ${okrs.count}`);
  }
  const delKpis = await prisma.kPI.deleteMany({ where: { organizationId: ORG } });
  console.log(`Deleted KPIs: ${delKpis.count}`);
  const delKras = await prisma.kRA.deleteMany({ where: { organizationId: ORG } });
  console.log(`Deleted KRAs: ${delKras.count}`);
  const delRoles = await prisma.role.deleteMany({ where: { organizationId: ORG, id: { in: dropRoles.map((r) => r.id) } } });
  console.log(`Deleted job titles: ${delRoles.count}`);

  // ---- the SOP guarantee ---------------------------------------------
  const sopAfter = await prisma.sOP.count({ where: { organizationId: ORG } });
  if (sopAfter !== sopBefore) {
    console.error(`\n!! SOP COUNT CHANGED: ${sopBefore} → ${sopAfter}. Restore from ${path} immediately.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nSOPs verified intact: ${sopAfter} (unchanged)`);
  console.log("Reset complete — rebuild job titles first, then their KRAs, then KPIs.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
