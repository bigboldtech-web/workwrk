import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { settingsKey, writeOrgSettingsKeys } from "@/lib/org-settings-write";
import { lockOrgSettings } from "@/lib/access/access-grant-store";
import { freshMayManageOwnerPage, freshWorkspaceActor, sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";

// POST /api/org/sign-out-everyone { confirm: "SIGN OUT" }: Workspace settings
// > Security > Danger zone. Ends every session that can act in this
// workspace, the caller's included, on its next check (at most five minutes,
// src/lib/auth.ts revalidation): a tokenVersion bump for everyone anchored
// here, and settings.security.signedOutEveryoneAt for members anchored in
// another company (their sessions end when they act here, never at home).
// No proof is returned: "Everyone, including you, signs in again." Owner
// page (every Admin until the Owner and Admin split).
const bodySchema = z.strictObject({ confirm: z.literal("SIGN OUT") });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const su = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!su?.id || !su.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await sessionMayManageOwnerPage(session, "security"))) return NextResponse.json({ error: "Only workspace Owners can sign everyone out" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Type SIGN OUT to confirm' }, { status: 400 });

  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) return NextResponse.json({ error: fresh.error, code: fresh.code }, { status: fresh.status });
  if (!freshMayManageOwnerPage(fresh, "security")) return NextResponse.json({ error: "Only workspace Owners can sign everyone out" }, { status: 403 });

  // Everyone anchored in this workspace: a tokenVersion bump ends every
  // session the account has. A person who only holds a MEMBERSHIP here and is
  // anchored in another company is NOT bumped (tokenVersion is per account,
  // so that would let this workspace end their sessions in their own
  // company, again and again). Instead the workspace stamps the moment, and
  // any session signed in before it that acts here ends at its next check
  // (src/lib/auth.ts, the revalidation), whichever workspace it came from.
  const stampedAt = new Date();
  const r = await prisma.$transaction(async (tx) => {
    const bumped = await tx.user.updateMany({
      where: { organizationId: su.organizationId },
      data: { tokenVersion: { increment: 1 } },
    });
    await lockOrgSettings(tx, su.organizationId as string);
    const row = await tx.organization.findUnique({ where: { id: su.organizationId }, select: { settings: true } });
    await writeOrgSettingsKeys(su.organizationId as string, { security: { ...settingsKey(row?.settings, "security"), signedOutEveryoneAt: stampedAt.toISOString() } }, tx);
    return bumped;
  });
  const elsewhere = await prisma.organizationMembership.count({
    where: { organizationId: su.organizationId, user: { organizationId: { not: su.organizationId } } },
  });
  logAuditEvent({
    type: "security.sign_out_all",
    actorId: su.id,
    organizationId: su.organizationId,
    description: `Signed everyone out (${r.count + elsewhere} ${r.count + elsewhere === 1 ? "person" : "people"})`,
    targetType: "Organization",
    targetId: su.organizationId,
    severity: "critical",
    metadata: { people: r.count + elsewhere, anchoredHere: r.count, membersElsewhere: elsewhere, stampedAt: stampedAt.toISOString() },
  });
  return NextResponse.json({ ok: true, signedOut: r.count + elsewhere });
}
