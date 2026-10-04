// Reset (or, on purpose, create) one workspace admin's password on ONE named
// database. Rewritten 2026-10-05. It used to hard-code the password it set,
// in a repository that is public; load .env through dotenv, which on a
// laptop points at production; and, when the account did not exist, create a
// COMPANY_ADMIN inside whichever organization findFirst() happened to return,
// which could be a customer's.
//
// Now it reads DATABASE_URL and nothing else (scripts/lib/script-prisma.ts),
// says which database it is pointed at before it writes, takes the password
// from the environment and never prints it, and creates an account only when
// told to and only in the organization named by id.
//
//   # Reset an existing account's password (and sign it out everywhere):
//   DIRECT_URL= DATABASE_URL=<the database> RESET_ADMIN_EMAIL=<email> RESET_ADMIN_PASSWORD=<new password> \
//     npx tsx scripts/reset-admin.ts
//
//   # Create it if missing, in that organization only:
//   DIRECT_URL= DATABASE_URL=<the database> RESET_ADMIN_EMAIL=<email> RESET_ADMIN_PASSWORD=<new password> \
//     RESET_ADMIN_ORG_ID=<organization id> npx tsx scripts/reset-admin.ts --create
//
// Never write a password into this file or any other in this repository.

import bcrypt from "bcryptjs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";

const prisma = scriptPrisma();

async function main() {
  const email = (process.env.RESET_ADMIN_EMAIL ?? "").trim();
  const password = process.env.RESET_ADMIN_PASSWORD ?? "";
  const create = process.argv.includes("--create");
  const orgId = (process.env.RESET_ADMIN_ORG_ID ?? "").trim();

  if (!email.includes("@")) throw new Error("Set RESET_ADMIN_EMAIL to the account's email address.");
  if (password.length < 12) throw new Error("Set RESET_ADMIN_PASSWORD (12 characters or more). It is never printed.");
  console.log(`Database: ${databaseLabel()}`);

  const now = new Date();
  const hash = await bcrypt.hash(password, 12);
  const matches = await prisma.user.findMany({ where: { email }, select: { id: true, organizationId: true } });

  if (matches.length > 1 && !orgId) {
    throw new Error(`${matches.length} accounts use ${email} (one per workspace). Set RESET_ADMIN_ORG_ID to say which one.`);
  }
  const user = orgId ? matches.find((m) => m.organizationId === orgId) : matches[0];

  if (user) {
    // A new password, and every live session of the account ends at its next check.
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, passwordChangedAt: now, tokenVersion: { increment: 1 } },
    });
    console.log(`Password reset for ${email} in workspace ${user.organizationId}; its sessions are signed out.`);
    return;
  }

  if (!create) throw new Error(`No account ${email}${orgId ? ` in workspace ${orgId}` : ""}. Nothing was created (pass --create with RESET_ADMIN_ORG_ID to create it).`);
  if (!orgId) throw new Error("--create needs RESET_ADMIN_ORG_ID: an account is never created in a guessed workspace.");
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) throw new Error(`No workspace with id ${orgId}. Nothing was created.`);

  await prisma.user.create({
    data: {
      email,
      firstName: "Admin",
      lastName: "WorkwrK",
      passwordHash: hash,
      passwordChangedAt: now,
      accessLevel: "COMPANY_ADMIN",
      organizationId: org.id,
    },
  });
  console.log(`Admin account ${email} created in workspace ${org.id}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
