import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcryptjs";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "admin@workwrk.com";
  const password = "Admin@1212@TW";
  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.findFirst({ where: { email } });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });
    console.log(`Password reset for ${email}`);
  } else {
    console.log(`User ${email} not found. Creating...`);

    // Get or create an organization
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: "WorkwrK", slug: "workwrk", plan: "GROWTH", status: "ACTIVE" },
      });
    }

    await prisma.user.create({
      data: {
        email,
        firstName: "Admin",
        lastName: "WorkwrK",
        passwordHash: hash,
        accessLevel: "COMPANY_ADMIN",
        organizationId: org.id,
      },
    });
    console.log(`Admin user created: ${email}`);
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
