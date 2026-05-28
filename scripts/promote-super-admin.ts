/**
 * One-shot promotion: flip a user's accessLevel to SUPER_ADMIN. Used
 * to seed the WorkwrK staff side of the app.
 *
 *   DATABASE_URL=... npx tsx scripts/promote-super-admin.ts <email>
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
  const email = process.argv[2];
  if (!email) throw new Error("Usage: promote-super-admin.ts <email>");

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, firstName: true, accessLevel: true },
  });
  if (!user) throw new Error(`No user with email ${email}`);

  if (user.accessLevel === "SUPER_ADMIN") {
    console.log(`Already SUPER_ADMIN: ${user.email}`);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { accessLevel: "SUPER_ADMIN" },
    select: { email: true, accessLevel: true },
  });
  console.log(`Promoted: ${updated.email} → ${updated.accessLevel}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
