/**
 * reset-work-data.ts — wipe all WORK-SURFACE data for the real org to start
 * fresh, while KEEPING the whole SOP / KRA / KPI / Next-Step (ProcessRun)
 * layer, plus the org, users, files and links.
 *
 * DELETES (scoped to the org, in a child→parent FK-safe order):
 *   Item → Board → Folder → Space → Task → Doc → Whiteboard → DataTable
 *   (deleting Boards/Items also cascades their comments, activity, etc.)
 *
 * KEEPS: SOPs (+ versions/folders/categories), ProcessRuns (Next-Step runs),
 *        SOP assignments + compliance, KRAs, KPIs, organization, users.
 *
 *   npx tsx scripts/reset-work-data.ts            # dry run — counts only
 *   npx tsx scripts/reset-work-data.ts --confirm  # actually delete
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvFile(".env.production");
loadEnvFile(".env");

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const CONFIRM = process.argv.includes("--confirm");
const MIN_REAL_USERS = 10;

// child → parent so FK constraints never block a delete.
const DELETE_MODELS = ["item", "board", "folder", "space", "task", "doc", "whiteboard", "dataTable"] as const;
const KEEP_MODELS = ["sOP", "processRun", "kRA", "kPI"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

async function countSafe(model: string, orgId: string): Promise<number | string> {
  try {
    return await db[model].count({ where: { organizationId: orgId } });
  } catch {
    return "n/a";
  }
}

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, _count: { select: { users: true } } },
  });
  const real = orgs.filter((o) => o._count.users >= MIN_REAL_USERS);
  if (real.length === 0) {
    console.error(`ABORT: no org with >= ${MIN_REAL_USERS} users found. Nothing done.`);
    process.exit(1);
  }

  for (const org of real) {
    console.log(`\nOrg: ${org.name} (${org._count.users} users)`);
    console.log("  KEEP (untouched):");
    for (const m of KEEP_MODELS) console.log(`    ${m}: ${await countSafe(m, org.id)}`);
    console.log("  DELETE:");
    for (const m of DELETE_MODELS) console.log(`    ${m}: ${await countSafe(m, org.id)}`);

    if (CONFIRM) {
      console.log("  deleting…");
      for (const m of DELETE_MODELS) {
        try {
          const r = await db[m].deleteMany({ where: { organizationId: org.id } });
          console.log(`    deleted ${m}: ${r.count}`);
        } catch (e) {
          console.error(`    FAILED ${m}: ${(e as Error).message}`);
        }
      }
    }
  }

  if (!CONFIRM) console.log("\nDRY RUN — nothing deleted. Re-run with --confirm to wipe work-surface data.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
