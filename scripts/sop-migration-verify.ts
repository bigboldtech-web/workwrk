/**
 * Post-migration verification. Read-only — confirms every SOP is now in
 * a folder and prints the resulting tree.
 *
 *   DATABASE_URL=... npx tsx scripts/sop-migration-verify.ts
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  const totalSops = await prisma.sOP.count();
  const unfoldered = await prisma.sOP.count({ where: { folderId: null } });
  const stillNeedsMigration = await prisma.sOP.count({
    where: { folderId: null, category: { not: null } },
  });

  console.log("=== Post-migration state ===\n");
  console.log(`Total SOPs:                 ${totalSops}`);
  console.log(`SOPs unfoldered (any):      ${unfoldered}`);
  console.log(`SOPs unfoldered + has cat:  ${stillNeedsMigration} (should be 0)`);
  console.log();

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    where: { sops: { some: {} } },
  });

  for (const o of orgs) {
    console.log(`\n[${o.name}]`);
    const folders = await prisma.sOPFolder.findMany({
      where: { organizationId: o.id },
      select: {
        id: true, name: true, parentId: true, color: true,
        _count: { select: { sops: true } },
      },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    });

    const childrenOf = new Map<string | null, typeof folders>();
    for (const f of folders) {
      const arr = childrenOf.get(f.parentId) || [];
      arr.push(f);
      childrenOf.set(f.parentId, arr);
    }
    function rollupCount(id: string): number {
      const own = folders.find((f) => f.id === id)!._count.sops;
      const kids = (childrenOf.get(id) || []).reduce((s, k) => s + rollupCount(k.id), 0);
      return own + kids;
    }
    function print(parentId: string | null, depth: number) {
      for (const f of childrenOf.get(parentId) || []) {
        const indent = "  ".repeat(depth);
        const deep = rollupCount(f.id);
        console.log(`${indent}├─ ${f.name}  (${f._count.sops} own, ${deep} total)`);
        print(f.id, depth + 1);
      }
    }
    print(null, 0);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
