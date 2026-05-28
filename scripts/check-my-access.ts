/**
 * Read-only check: who am I + what's my access level. Used to debug
 * "I can't access /admin".
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
  const email = process.argv[2] || "bigboldtech@gmail.com";
  const u = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      accessLevel: true, organizationId: true,
      organization: { select: { name: true, plan: true, status: true } },
    },
  });
  if (!u) {
    console.log(`No user with email ${email}`);
    console.log("\nAll users (so you can find your login):");
    const all = await prisma.user.findMany({
      select: {
        email: true, firstName: true, lastName: true, accessLevel: true,
        organization: { select: { name: true } },
      },
      orderBy: { email: "asc" },
    });
    for (const x of all) {
      console.log(`  ${x.accessLevel.padEnd(15)} ${x.email}  ·  ${x.firstName} ${x.lastName}  ·  ${x.organization?.name}`);
    }
    return;
  }
  console.log(JSON.stringify(u, null, 2));

  // Anyone else flagged SUPER_ADMIN?
  const sa = await prisma.user.findMany({
    where: { accessLevel: "SUPER_ADMIN" },
    select: { email: true, organization: { select: { name: true } } },
  });
  console.log("\nAll SUPER_ADMIN users:");
  for (const s of sa) console.log(`  ${s.email} (${s.organization?.name})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
