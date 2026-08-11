// Reconcile the job-title ↔ holder invariant:
//
//   "Everyone holding a job title inherits that title's KRAs."
//
// Inheritance used to run ONLY when a person was assigned a role, so any
// KRA added to a role afterwards reached nobody. The API now seeds on KRA
// create/re-home, but rows created before that fix still need one pass.
//
// Safety: additive only. It creates missing KRAAssignment rows and never
// deletes, reassigns, or edits an existing one (weightage/period/status on
// existing assignments are untouched). Idempotent — re-running is a no-op.
//
//   node scripts/reconcile-role-kras.mjs                  # dry run (default)
//   node scripts/reconcile-role-kras.mjs --commit         # write
//   node scripts/reconcile-role-kras.mjs --org <orgId>    # limit to one org
//
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit") || argv.includes("--apply");
const orgArg = argv.indexOf("--org");
const ONLY_ORG = orgArg !== -1 ? argv[orgArg + 1] : null;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  console.log(COMMIT ? "MODE: COMMIT (writing)" : "MODE: DRY RUN (no writes — pass --commit to apply)");

  const roles = await prisma.role.findMany({
    where: ONLY_ORG ? { organizationId: ONLY_ORG } : {},
    select: {
      id: true,
      title: true,
      organizationId: true,
      kraTemplates: { select: { id: true, name: true } },
      users: {
        where: { status: "ACTIVE" },
        select: { id: true, firstName: true, lastName: true },
      },
    },
    orderBy: { title: "asc" },
  });

  let totalMissing = 0;
  let totalWritten = 0;
  const skipped = [];

  for (const role of roles) {
    const kraIds = role.kraTemplates.map((k) => k.id);
    if (kraIds.length === 0 || role.users.length === 0) {
      if (kraIds.length === 0 && role.users.length > 0) {
        skipped.push(`${role.title}: ${role.users.length} people, but the job title has NO KRAs yet`);
      }
      continue;
    }

    // What already exists, so we only ever add what is genuinely missing.
    const existing = await prisma.kRAAssignment.findMany({
      where: { kraId: { in: kraIds }, userId: { in: role.users.map((u) => u.id) } },
      select: { kraId: true, userId: true },
    });
    const have = new Set(existing.map((e) => `${e.userId}:${e.kraId}`));

    const missing = [];
    for (const user of role.users) {
      for (const kra of role.kraTemplates) {
        if (!have.has(`${user.id}:${kra.id}`)) {
          missing.push({ userId: user.id, kraId: kra.id, who: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(), what: kra.name });
        }
      }
    }
    if (missing.length === 0) continue;

    totalMissing += missing.length;
    console.log(`\n${role.title} — ${role.users.length} holder(s), ${kraIds.length} KRA(s): ${missing.length} missing link(s)`);
    for (const m of missing.slice(0, 8)) console.log(`   + ${m.who} ← ${m.what}`);
    if (missing.length > 8) console.log(`   … and ${missing.length - 8} more`);

    if (COMMIT) {
      const res = await prisma.kRAAssignment.createMany({
        data: missing.map((m) => ({ userId: m.userId, kraId: m.kraId })),
        skipDuplicates: true,
      });
      totalWritten += res.count;
    }
  }

  if (skipped.length) {
    console.log("\nJob titles with people but no KRAs (nothing to inherit — define their KRAs):");
    for (const s of skipped) console.log(`   • ${s}`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`Missing links found: ${totalMissing}`);
  console.log(COMMIT ? `Links created:       ${totalWritten}` : "Nothing written (dry run).");
  if (!COMMIT && totalMissing > 0) console.log("Re-run with --commit to apply.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
