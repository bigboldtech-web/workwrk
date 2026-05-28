import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  const totalActive = await prisma.sOP.count({ where: { status: { not: "ARCHIVED" } } });
  console.log(`Total active (non-archived): ${totalActive}\n`);

  const groups = await prisma.sOP.groupBy({
    by: ["category", "subcategory"],
    where: { status: { not: "ARCHIVED" } },
    _count: { _all: true },
  });

  // Roll up by category.
  const byCat = new Map<string, { total: number; subs: { name: string; count: number }[] }>();
  for (const g of groups) {
    const k = g.category ?? "(uncategorized)";
    if (!byCat.has(k)) byCat.set(k, { total: 0, subs: [] });
    const entry = byCat.get(k)!;
    entry.total += g._count._all;
    if (g.subcategory) entry.subs.push({ name: g.subcategory, count: g._count._all });
  }

  let sum = 0;
  for (const [cat, info] of [...byCat.entries()].sort()) {
    console.log(`  ${cat}  →  ${info.total}`);
    sum += info.total;
    for (const s of info.subs.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`      └─ ${s.name}  →  ${s.count}`);
    }
  }
  console.log(`\nSum of buckets:  ${sum}  (should equal total active above)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
