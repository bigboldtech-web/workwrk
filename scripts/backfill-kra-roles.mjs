// Backfill: attach orphan KRAs (roleId null) to a job title.
//
// The role-first spine says a KRA exists only inside a Role. POST
// /api/kras now refuses to create orphans; this script proposes homes
// for the LEGACY ones. For each orphan it looks at the distinct job
// titles held by its ACTIVE assignees:
//
//   exactly one distinct role → PROPOSED  (written only with --commit)
//   more than one             → AMBIGUOUS (reported for the admin; the
//                                /kra-kpi orphan section fixes by hand)
//   no active assignees       → UNASSIGNED (reported, left alone)
//
// DATA INTEGRITY: dry-run by default; never deletes anything; never
// touches assignments or KPI records; never overwrites a non-null
// roleId (idempotent — the write is guarded on roleId still being null,
// so re-running is always safe).
//
// Usage: node scripts/backfill-kra-roles.mjs
//   --commit      Actually write the PROPOSED updates (alias: --apply)
//   --org=ID      Limit to one organization id

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

// .env.local (local dev DB) wins over .env when both exist — dotenv
// never overwrites a variable that is already set.
loadEnv({ path: ".env.local" });
loadEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const commit = process.argv.includes("--commit") || process.argv.includes("--apply");
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const limitToOrg = orgArg ? orgArg.split("=")[1] : null;

function fullName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.id;
}

async function main() {
  const orphans = await prisma.kRA.findMany({
    where: { roleId: null, ...(limitToOrg ? { organizationId: limitToOrg } : {}) },
    select: {
      id: true,
      name: true,
      organizationId: true,
      organization: { select: { name: true } },
      assignments: {
        where: { status: "ACTIVE" },
        select: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              deletedAt: true,
              organizationId: true,
              role: { select: { id: true, title: true, organizationId: true } },
            },
          },
        },
      },
    },
    orderBy: [{ organizationId: "asc" }, { name: "asc" }],
  });

  const proposed = [];
  const ambiguous = [];
  const unassigned = [];

  for (const kra of orphans) {
    // Live holders only, and only roles that live in the KRA's own org.
    const holders = kra.assignments
      .map((a) => a.user)
      .filter((u) => u && !u.deletedAt);
    const roles = new Map();
    for (const u of holders) {
      if (u.role && u.role.organizationId === kra.organizationId) {
        roles.set(u.role.id, u.role);
      }
    }

    if (roles.size === 1) {
      const role = roles.values().next().value;
      proposed.push({ kra, role, holders });
    } else if (roles.size > 1) {
      ambiguous.push({ kra, roles: [...roles.values()], holders });
    } else {
      unassigned.push({ kra, holders });
    }
  }

  console.log(`\nOrphan KRAs (roleId null): ${orphans.length}`);
  console.log(`  proposed:   ${proposed.length}  (all active assignees share ONE job title)`);
  console.log(`  ambiguous:  ${ambiguous.length}  (assignees span multiple job titles — fix by hand)`);
  console.log(`  unassigned: ${unassigned.length}  (no active assignees — fix by hand)\n`);

  for (const { kra, role, holders } of proposed) {
    console.log(
      `PROPOSED   [${kra.organization?.name ?? kra.organizationId}] "${kra.name}" → "${role.title}"` +
        ` (${holders.length} active holder${holders.length === 1 ? "" : "s"})`,
    );
  }
  for (const { kra, roles } of ambiguous) {
    console.log(
      `AMBIGUOUS  [${kra.organization?.name ?? kra.organizationId}] "${kra.name}" — holders span: ` +
        roles.map((r) => `"${r.title}"`).join(", "),
    );
  }
  for (const { kra, holders } of unassigned) {
    console.log(
      `UNASSIGNED [${kra.organization?.name ?? kra.organizationId}] "${kra.name}"` +
        (holders.length ? ` — ${holders.map(fullName).join(", ")} hold no role` : " — no active assignees"),
    );
  }

  if (!commit) {
    console.log(`\nDRY RUN — nothing written. Re-run with --commit to apply the ${proposed.length} proposed update(s).`);
    return;
  }

  let written = 0;
  for (const { kra, role } of proposed) {
    // Guarded write: only fills a STILL-null roleId (idempotent, never
    // overwrites a decision made since the report was computed).
    const res = await prisma.kRA.updateMany({
      where: { id: kra.id, roleId: null },
      data: { roleId: role.id },
    });
    if (res.count === 1) {
      written += 1;
      console.log(`WROTE      "${kra.name}" → "${role.title}"`);
    } else {
      console.log(`SKIPPED    "${kra.name}" — roleId was set by someone else since the scan`);
    }
  }
  console.log(`\nDone. ${written}/${proposed.length} proposed update(s) written; ambiguous/unassigned untouched.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
