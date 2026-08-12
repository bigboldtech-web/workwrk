// Backfill KRAAssignment.weightage from the KRA's role-level weight.
//
// Seeding used to create assignments WITHOUT a weightage, so every seeded
// row landed on the 0 default (five KRAs at 0%, header total 0%). Seeding
// now copies KRA.weight; this script repairs the rows created before that
// fix.
//
// THE ONE RULE: a non-zero weightage was set by a person and is NEVER
// overwritten. Only assignments still sitting at exactly 0 adopt their
// KRA's role-level weight — and only when that weight is > 0 (adopting a
// 0 would be a no-op anyway).
//
// EXPLICITLY OUT OF SCOPE — never touched, and asserted afterwards:
//   • SOPs and SOP assignments (counted before and after; abort on drift)
//   • KRAs, KPIs, KPI records (same assertion)
//   • KRAAssignment rows themselves — none created, none deleted; the row
//     count is asserted identical. Only weightage on 0-value rows moves.
//
// A full JSON backup of every row about to change is written BEFORE any
// write, so the pass is recoverable.
//
//   node scripts/backfill-kra-weights.mjs --org <orgId>            # dry run
//   node scripts/backfill-kra-weights.mjs --org <orgId> --commit
//
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const COMMIT = argv.includes("--commit");
const ORG = flag("--org");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!ORG) { console.error("--org <organizationId> is required (refusing to run org-wide)."); process.exit(1); }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function counts() {
  const [sop, sopAssignment, kra, kpi, kpiRecord, kraAssignment] = await Promise.all([
    prisma.sOP.count({ where: { organizationId: ORG } }),
    prisma.sOPAssignment.count({ where: { sop: { organizationId: ORG } } }),
    prisma.kRA.count({ where: { organizationId: ORG } }),
    prisma.kPI.count({ where: { organizationId: ORG } }),
    prisma.kPIRecord.count({ where: { kpi: { organizationId: ORG } } }),
    prisma.kRAAssignment.count({ where: { kra: { organizationId: ORG } } }),
  ]);
  return { sop, sopAssignment, kra, kpi, kpiRecord, kraAssignment };
}

async function main() {
  console.log(COMMIT ? "MODE: COMMIT (writing)" : "MODE: DRY RUN (no writes — add --commit to apply)");

  const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { id: true, name: true } });
  if (!org) { console.error("Organization not found."); process.exit(1); }
  console.log(`Organization: ${org.name}\n`);

  // ---- what will change ------------------------------------------------
  // Exactly-0 assignments whose KRA carries a usable role weight.
  const candidates = await prisma.kRAAssignment.findMany({
    where: {
      weightage: 0,
      kra: { organizationId: ORG, weight: { gt: 0 } },
    },
    include: {
      kra: { select: { id: true, name: true, weight: true, role: { select: { title: true } } } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Untouchables, reported so the rule is visible in the output.
  const handSet = await prisma.kRAAssignment.count({
    where: { weightage: { not: 0 }, kra: { organizationId: ORG } },
  });
  const zeroNoWeight = await prisma.kRAAssignment.count({
    where: { weightage: 0, kra: { organizationId: ORG, weight: 0 } },
  });

  console.log(`Assignments at 0% adopting their KRA's role weight: ${candidates.length}`);
  console.log(`Left alone — non-zero weightage set by hand: ${handSet}`);
  console.log(`Left alone — 0% but the KRA has no role weight yet: ${zeroNoWeight}\n`);

  const who = (u) => `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
  for (const c of candidates.slice(0, 20)) {
    console.log(`  ${who(c.user)}  ·  ${c.kra.name}${c.kra.role ? ` (${c.kra.role.title})` : ""}  0% → ${c.kra.weight}%`);
  }
  if (candidates.length > 20) console.log(`  … and ${candidates.length - 20} more`);

  // Per-person totals after adoption — flag anyone the adoption pushes
  // past 100 so an admin can rebalance (nothing is skipped or capped;
  // the role page and dialog surface the same red total).
  const byUser = new Map();
  const active = await prisma.kRAAssignment.findMany({
    where: { kra: { organizationId: ORG }, status: { not: "ARCHIVED" } },
    select: { id: true, userId: true, weightage: true },
  });
  const adopt = new Map(candidates.map((c) => [c.id, c.kra.weight]));
  for (const a of active) {
    const w = a.weightage === 0 && adopt.has(a.id) ? adopt.get(a.id) : a.weightage;
    byUser.set(a.userId, (byUser.get(a.userId) ?? 0) + w);
  }
  const over = [...byUser.entries()].filter(([, t]) => t > 100);
  if (over.length) {
    console.log(`\nWARNING: ${over.length} person(s) would total over 100% after adoption — rebalance from Manage alignment:`);
    const users = await prisma.user.findMany({ where: { id: { in: over.map(([id]) => id) } }, select: { id: true, firstName: true, lastName: true, email: true } });
    const nameById = new Map(users.map((u) => [u.id, who(u)]));
    for (const [id, t] of over) console.log(`  ${nameById.get(id) ?? id}: ${Math.round(t * 100) / 100}%`);
  }

  // ---- the things that must not move ------------------------------------
  const before = await counts();
  console.log("\nMust be unchanged:");
  console.log(`  SOPs ...................... ${before.sop}`);
  console.log(`  SOP assignments ........... ${before.sopAssignment}`);
  console.log(`  KRAs ...................... ${before.kra}`);
  console.log(`  KPIs ...................... ${before.kpi}`);
  console.log(`  KPI records ............... ${before.kpiRecord}`);
  console.log(`  KRA assignment rows ....... ${before.kraAssignment}`);

  if (candidates.length === 0) {
    console.log("\nNothing to backfill.");
    return;
  }
  if (!COMMIT) {
    console.log("\nDry run only. Re-run with --commit to apply.");
    return;
  }

  // ---- backup before touching anything ----------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `/tmp/workwrk-kra-weights-backup-${stamp}.json`;
  writeFileSync(path, JSON.stringify({
    takenAt: new Date().toISOString(),
    organizationId: ORG,
    assignments: candidates.map((c) => ({
      id: c.id, userId: c.userId, kraId: c.kraId,
      weightage: c.weightage, period: c.period, status: c.status,
      adopting: c.kra.weight,
    })),
  }, null, 2));
  console.log(`\nBackup written: ${path}`);

  // ---- apply: group by KRA, update only the exact rows backed up --------
  let updated = 0;
  const byKra = new Map();
  for (const c of candidates) {
    if (!byKra.has(c.kraId)) byKra.set(c.kraId, { weight: c.kra.weight, ids: [] });
    byKra.get(c.kraId).ids.push(c.id);
  }
  for (const [, { weight, ids }] of byKra) {
    // weightage: 0 in the WHERE makes the write race-safe: a weight a
    // person set between the scan and this update is never clobbered.
    const res = await prisma.kRAAssignment.updateMany({
      where: { id: { in: ids }, weightage: 0 },
      data: { weightage: weight },
    });
    updated += res.count;
  }
  console.log(`Updated: ${updated} assignment(s)`);

  // ---- assert nothing else moved -----------------------------------------
  const after = await counts();
  const drift = Object.keys(before).filter((k) => before[k] !== after[k]);
  if (drift.length) {
    console.error(`\n!! COLLATERAL CHANGE in: ${drift.map((k) => `${k} ${before[k]} → ${after[k]}`).join(", ")}`);
    console.error(`Restore from ${path} immediately.`);
    process.exit(1);
  }
  const stillHandSet = await prisma.kRAAssignment.count({
    where: { weightage: { not: 0 }, kra: { organizationId: ORG } },
  });
  console.log("\nVerified: SOPs, SOP assignments, KRAs, KPIs, KPI records and the assignment row count all unchanged.");
  console.log(`Non-zero (hand-set + adopted) assignments now: ${stillHandSet} (was ${handSet}, adopted ${updated}).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
