// Reset one account's two step verification from the server: the way back in
// for a workspace's ONLY Owner who lost their authenticator and backup codes
// (launch audit, 2026-10-31). Everyone else is reset by an Owner or Admin in
// Settings, Members (POST /api/users/[id]/mfa-reset); an Owner has nobody
// above them in the product, so this is the staff path. Run by the founder
// over SSH, after confirming who is asking (a call, not an email).
//
// WHAT IT DOES, with --write: the account's two step verification off
// (secret and backup codes gone) and every session of the account ended
// (tokenVersion), so whoever holds the lost phone or an old session is out,
// plus a critical security-log row. Without --write it prints what it would
// do and writes nothing.
//
// Usage:
//   npx tsx scripts/reset-two-step.ts --email=<address>            dry run
//   npx tsx scripts/reset-two-step.ts --email=<address> --write    reset
//
// It refuses an address that matches no account, or more than one that can
// sign in (say which workspace with --org=<id>). It runs only when executed
// directly; importing it does nothing. DATABASE_URL comes from .env.local,
// then .env.

import type { PrismaClient as Client } from "../src/generated/prisma";

export interface ResetCandidate {
  id: string;
  email: string;
  organizationId: string;
  deletedAt: Date | null;
  status: string;
  mfaEnabled: boolean;
}

/** Which account to reset (pure): the one live account with this address, else a reason. */
export function pickResetAccount(rows: readonly ResetCandidate[], org: string | null): { ok: true; row: ResetCandidate } | { ok: false; reason: string } {
  const live = rows.filter((r) => !r.deletedAt && r.status !== "INACTIVE" && (!org || r.organizationId === org));
  if (live.length === 0) return { ok: false, reason: "No account that can sign in has this address." };
  if (live.length > 1) return { ok: false, reason: `${live.length} accounts that can sign in have this address. Name the workspace with --org=<id>.` };
  if (!live[0].mfaEnabled) return { ok: false, reason: "Two step verification is already off for this account." };
  return { ok: true, row: live[0] };
}

async function main(): Promise<void> {
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: ".env.local" });
  loadEnv();
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../src/generated/prisma");
  const prisma: Client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const WRITE = process.argv.includes("--write");
  const arg = (name: string): string | null => {
    const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : null;
  };
  const email = arg("email")?.trim() ?? "";
  if (!email.includes("@")) {
    console.error("Give the account's address: --email=<address>");
    process.exitCode = 1;
    return;
  }
  try {
    const rows = await prisma.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, organizationId: true, deletedAt: true, status: true, mfaEnabled: true },
      take: 20,
    });
    const pick = pickResetAccount(rows.map((r) => ({ ...r, status: String(r.status) })), arg("org"));
    if (!pick.ok) {
      console.log(JSON.stringify({ ok: false, email, reason: pick.reason }, null, 2));
      process.exitCode = 1;
      return;
    }
    const { row } = pick;
    console.log(JSON.stringify({ ok: true, mode: WRITE ? "write" : "dry run", account: row.id, workspace: row.organizationId, email: row.email }, null, 2));
    if (!WRITE) {
      console.log("Dry run: nothing written. Run again with --write to reset.");
      return;
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.id },
        data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], tokenVersion: { increment: 1 } },
      }),
      // A staff row, as src/lib/staff-audit.ts writes them: no workspace
      // person did this, so no actorId, and actorType says who did.
      prisma.activityLog.create({
        data: {
          type: "mfa_reset_by_staff",
          actorType: "platform_staff",
          actorLabel: "WorkwrK support",
          organizationId: row.organizationId,
          description: "Two step verification reset by WorkwrK support",
          targetType: "User",
          targetId: row.id,
          severity: "critical",
        },
      }),
    ]);
    console.log("Reset. They sign in with their password and set up an authenticator again.");
  } finally {
    await prisma.$disconnect();
  }
}

if (/reset-two-step\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
