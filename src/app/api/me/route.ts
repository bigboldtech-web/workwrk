// /api/me: the signed-in person's own record. Read by My settings (Profile
// and Security), and lightly by other surfaces that only need the id.
//
// Every field here is the viewer's own. The role comes back as the four-role
// word (Owner, Admin, Member, Guest; src/lib/access/labels.ts renders it),
// never as the raw ladder enum. Backup codes come back as a COUNT only; the
// hashes never leave the server.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { selfAccountFacts } from "@/lib/access/self-facts";
import { mfaRequiredFor, passwordMaxAgeDaysOf } from "@/lib/auth/security-policy";
import { policyFromOrgSettings } from "@/lib/password-policy";
import { policyView } from "@/lib/auth/password-rules";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const [user, acting] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        id: true, firstName: true, lastName: true, email: true, avatar: true,
        phone: true, dateOfBirth: true, emailVerifiedAt: true, passwordChangedAt: true,
        mfaEnabled: true, mfaBackupCodes: true, createdAt: true,
        department: { select: { id: true, name: true } },
        role: { select: { id: true, title: true } },
        office: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        organization: { select: { id: true, name: true, settings: true } },
      },
    }),
    // The workspace the session acts in decides whether two step verification
    // is required, as the server enforces it (DELETE /api/auth/mfa/enroll).
    selfAccountFacts(ctx.userId, ctx.orgId),
  ]);
  if (!user || !acting) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The place card, the password rules and the expiry describe the
  // workspace the account is anchored to (its title, department and manager
  // are that workspace's; /api/me/change-password checks its rules), so the
  // role shown there is the one held there.
  const anchoredHere = user.organization.id === ctx.orgId;
  const facts = anchoredHere ? acting : await selfAccountFacts(ctx.userId, user.organization.id);
  const actingOrg = anchoredHere
    ? user.organization
    : await prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { id: true, name: true, settings: true } });
  if (!facts || !actingOrg) return NextResponse.json({ error: "not found" }, { status: 404 });

  // A password changed before the passwordChangedAt column existed has only
  // its security activity row. Read that as the date for the Password row,
  // so the row and the activity table on the same page never contradict
  // each other. Display only: the expiry hold keeps reading the column
  // (null there means no hold, the safe direction).
  let passwordChangedAt = user.passwordChangedAt;
  if (!passwordChangedAt) {
    const last = await prisma.activityLog
      .findFirst({
        where: { actorId: ctx.userId, type: { in: ["password_changed", "password_reset"] } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
      .catch(() => null);
    passwordChangedAt = last?.createdAt ?? null;
  }

  const { mfaBackupCodes, organization, ...rest } = user;
  return NextResponse.json(
    {
      user: {
        ...rest,
        passwordChangedAt,
        orgRole: facts.orgRole,
        isAgent: facts.isAgent,
        isLastAdmin: facts.isLastAdmin,
        backupCodesLeft: mfaBackupCodes.length,
        organization: { id: organization.id, name: organization.name },
        policy: {
          mfaRequired: mfaRequiredFor(actingOrg.settings, acting.orgRole),
          // The workspace whose rule that is, for "Required by".
          mfaOrgName: actingOrg.name,
          passwordMaxAgeDays: passwordMaxAgeDaysOf(organization.settings),
          // The rules the Change password dialog prints, from the same
          // policy object /api/me/change-password validates against.
          password: policyView(policyFromOrgSettings(organization.settings)),
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
