/**
 * wipe-tasks.ts — start task tracking from scratch. Deletes ALL tasks for the
 * real org: both `Task` rows (the HR / personal task list) and `Item` rows
 * (the cards inside Spaces/Boards). Does NOT touch SOPs, KRAs, KPIs, Spaces,
 * Boards, Docs, or anything else.
 *
 *   npx tsx scripts/wipe-tasks.ts            # dry run — just counts
 *   npx tsx scripts/wipe-tasks.ts --confirm  # actually delete
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

// Load .env without the dotenv dep (not installed on the server).
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
const MIN_REAL_USERS = 10; // only operate on the real org

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
    const tasks = await prisma.task.count({ where: { organizationId: org.id } });
    const items = await prisma.item.count({ where: { organizationId: org.id } });
    console.log(`\nOrg: ${org.name} (${org._count.users} users)`);
    console.log(`  Task rows (personal/HR task list): ${tasks}`);
    console.log(`  Item rows (cards in Spaces/Boards): ${items}`);
    console.log(`  SOPs / KRAs / KPIs / Spaces / Boards: NOT touched`);

    if (CONFIRM) {
      // Items first (they may FK-reference nothing tasks need); both cascade
      // their own children via the schema's onDelete rules.
      let itemRes = { count: 0 };
      let taskRes = { count: 0 };
      try {
        itemRes = await prisma.item.deleteMany({ where: { organizationId: org.id } });
      } catch (e) {
        console.error(`  Item delete failed: ${(e as Error).message}`);
      }
      try {
        taskRes = await prisma.task.deleteMany({ where: { organizationId: org.id } });
      } catch (e) {
        console.error(`  Task delete failed: ${(e as Error).message}`);
      }
      console.log(`  → deleted ${taskRes.count} tasks + ${itemRes.count} board items`);
    }
  }

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing deleted. Re-run with --confirm to wipe tasks + board items.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
