/**
 * Read-only: report everything tied to the legacy "TheywrK" org
 * before we delete it. No writes.
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
  const orgs = await prisma.organization.findMany({
    where: { name: { contains: "theywrk", mode: "insensitive" } },
    select: {
      id: true, name: true, slug: true, plan: true, status: true,
      _count: {
        select: {
          users: true, sops: true, kras: true, tasks: true,
          departments: true, offices: true, kpis: true,
        },
      },
    },
  });
  console.log(`Orgs matching "theywrk": ${orgs.length}\n`);
  for (const o of orgs) {
    console.log(JSON.stringify(o, null, 2));
  }

  const users = await prisma.user.findMany({
    where: { email: { contains: "theywrk", mode: "insensitive" } },
    select: { id: true, email: true, accessLevel: true, organization: { select: { name: true } } },
  });
  console.log(`\nUsers w/ theywrk in email: ${users.length}`);
  for (const u of users) console.log(`  ${u.accessLevel.padEnd(15)} ${u.email} (${u.organization?.name})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
