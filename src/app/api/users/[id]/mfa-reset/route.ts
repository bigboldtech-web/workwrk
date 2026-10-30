// POST /api/users/[id]/mfa-reset { confirm: "RESET" }: Settings > Members,
// a member's drawer, "Reset two step verification". The way back in for
// someone who lost their authenticator and their backup codes (launch audit,
// 2026-10-31): the only other write that turns it off is their own, and it
// needs a valid code, so with two step verification required at sign-in a
// lost phone was a lockout until someone edited the database.
//
// WHO. An Owner or an Admin of this workspace, as the database has them now
// (freshWorkspaceActor). An Admin resets Members and Guests only: resetting
// an Admin or an Owner is for an Owner, so one Admin can never strip
// another's protection. Never the caller's own (they turn theirs off in My
// settings, with a code). The sole Owner who is locked out is reset from the
// server (scripts/reset-two-step.ts).
//
// WHOSE. Only someone whose account is ANCHORED in this workspace: two step
// verification belongs to the account, not to a workspace, so an Admin here
// must never weaken the account of a person who works here through a
// membership and signs in to another company. Their own workspace's Admins
// reset it there.
//
// WHAT. Two step verification off (secret and backup codes gone), and every
// session and AI app of the account ends (tokenVersion), so whoever holds the
// lost phone or an old session is out; at the next sign-in the person sets
// it up again when the workspace requires it. A critical security-log row,
// and an email to the person so a reset they did not ask for is noticed.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { freshActorRefusal, freshWorkspaceActor, mfaResetTarget } from "@/lib/access/workspace-admin";
import { revokeLeftBehind } from "@/lib/oauth/grants";
import { rateLimit, ipFromRequest } from "@/lib/rate-limit-memory";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { escapeHtml } from "@/lib/email-templates/escape";

const bodySchema = z.strictObject({ confirm: z.literal("RESET") });
const err = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const su = session?.user as { id?: string; organizationId?: string; name?: string | null } | undefined;
  if (!su?.id || !su.organizationId) return err(401, "Unauthorized");
  const orgId = su.organizationId;
  const { id } = await params;

  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) return freshActorRefusal(fresh);
  if (!fresh.admin) return err(403, "Only workspace Owners and Admins can reset two step verification.");
  if (id === su.id) return err(400, "Turn your own off in My settings, Security, with a code from your app.");
  if (!bodySchema.safeParse(await req.json().catch(() => null)).success) return err(400, "Type RESET to confirm");

  const guard = rateLimit(`mfa-reset:${su.id}`, { max: 10, windowMs: 60 * 60 * 1000 });
  if (!guard.ok) return err(429, `Too many resets. Try again in ${Math.ceil(guard.retryAfter / 60)} minutes.`);

  const target = await mfaResetTarget(orgId, id);
  if (!target.ok) return err(target.status, target.error);
  const name = target.name;
  if (!fresh.owner && target.adminTier) {
    return err(403, "Only an Owner can reset an Admin's or an Owner's two step verification.");
  }
  if (!target.mfaEnabled) return err(400, `Two step verification is already off for ${name}.`);

  await prisma.user.update({
    where: { id: target.id },
    data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], tokenVersion: { increment: 1 } },
  });
  // The bump ends their AI apps at their next request; revoke them now, as
  // sign-out-everyone does. A failure is left to the nightly sweep.
  try {
    await revokeLeftBehind({ userIds: [target.id], actorId: su.id });
  } catch {
    console.warn("[oauth] mfa_reset revoke_failed");
  }
  logAuditEvent({
    type: "mfa_reset_by_admin",
    actorId: su.id,
    organizationId: orgId,
    description: `Reset two step verification for ${name}`,
    targetType: "User",
    targetId: target.id,
    ipAddress: ipFromRequest(req),
    userAgent: req.headers.get("user-agent"),
    severity: "critical",
  });
  // A security notice: no category, so no notification preference can mute it.
  const by = escapeHtml(su.name?.trim() || "An admin");
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://app.workwrk.com").replace(/\/+$/, "");
  const { subject, html } = genericNotificationTemplate({
    heading: "Two step verification was reset",
    subjectText: `${by} turned off two step verification on your account and signed you out everywhere.`,
    itemTitle: "Sign in again with your password",
    itemDetails: "If your workspace requires it, you set up your authenticator again when you sign in.",
    note: "If you did not ask for this, tell your workspace admin now.",
    actionLabel: "Sign in",
    actionLink: `${base}/login`,
  });
  void sendEmail({ to: target.email, subject, html, template: "mfa-reset", organizationId: orgId, userId: target.id })
    .catch((e: unknown) => console.error("[mfa-reset] email failed", e instanceof Error ? e.message : e));

  return NextResponse.json({ ok: true });
}
