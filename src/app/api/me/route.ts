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

  const [user, facts] = await Promise.all([
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
    selfAccountFacts(ctx.userId, ctx.orgId),
  ]);
  if (!user || !facts) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { mfaBackupCodes, organization, ...rest } = user;
  return NextResponse.json(
    {
      user: {
        ...rest,
        orgRole: facts.orgRole,
        isAgent: facts.isAgent,
        isLastAdmin: facts.isLastAdmin,
        backupCodesLeft: mfaBackupCodes.length,
        organization: { id: organization.id, name: organization.name },
        policy: {
          mfaRequired: mfaRequiredFor(organization.settings, facts.orgRole),
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
