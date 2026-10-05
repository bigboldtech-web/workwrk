// /api/auth/accept-invite: what /join reads and posts (spec-account-auth
// `/join`).
//
// GET ?token=  the invitation's real facts, and the two facts the page's
//              variants need (accountExists, alreadyInThisOrg). A failure is
//              a `code` the page turns into its own screen: invalid (404),
//              used or expired (410), with the org and the inviter so the
//              expired screen can say who to ask.
// POST         two branches, both returning `landing` (resolved here, never
//              guessed by the client: the invitation's Space, else Work home):
//   signed out  { token, firstName, lastName, password }: a brand new person.
//               The inviting workspace's password policy is enforced; the
//               User row, the role's KRAs and SOPs and the Space the
//               invitation carried are written in one transaction. When the
//               address already has a live account anywhere it answers 409
//               `account_exists` and creates NOTHING (it used to create a
//               second User row for the same mailbox, which made log in
//               ambiguous); the page shows "Log in and join".
//   signed in   { token } as the invited address: no password is read or
//               accepted. The write is a membership for the existing person
//               plus the invitation's Space grant, and a move into the
//               workspace just joined through reanchorUser (the workspace
//               left stays a membership at the level held there). Signed in
//               as anyone else is a 409 `wrong_account` and writes nothing.
// Both: rate limited per IP; an address already in the workspace is a 409
// `member` (the "You are already in {Org}" screen), never a raw 400.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import type { Prisma } from "@/generated/prisma";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { welcomeTemplate } from "@/lib/email-templates";
import { validatePassword, policyFromOrgSettings } from "@/lib/password-policy";
import { recordSpaceInviteAccepted } from "@/lib/access/grants";
import { reanchorUser } from "@/lib/access/workspace-anchor";
import { cleanPersonName, inviteFailure, inviteOrgRole, inviteRoleLabel, joinLanding, spaceObjectRoleLabel } from "@/lib/access/join-invite";
import { isAgentOf, orgRoleOf } from "@/lib/access/org-role";
import { policyView } from "@/lib/auth/password-rules";
import { alreadyInOrg, invitePlacement, inviteSender, liveAccountFor } from "@/lib/auth/invite-facts.server";
import { appBaseUrl } from "@/lib/auth/send-verification";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";
import { logAuditEvent } from "@/lib/activity";
import { lockWorkspaceSeats, personFitsOnAccept } from "@/lib/seats";

export const dynamic = "force-dynamic";

type Tx = Prisma.TransactionClient;

function fail(code: string, status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, code, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

const INVITE_SELECT = {
  id: true,
  email: true,
  accessLevel: true,
  accepted: true,
  expiresAt: true,
  organizationId: true,
  departmentId: true,
  roleId: true,
  managerId: true,
  officeId: true,
  firstName: true,
  lastName: true,
  phone: true,
  kraIds: true,
  sopIds: true,
  spaceId: true,
  spaceRole: true,
  organization: { select: { name: true, logo: true, status: true, settings: true } },
} as const;

async function loadInvitation(token: string) {
  if (!token || token.length > 256) return null;
  return prisma.invitation.findUnique({ where: { token }, select: INVITE_SELECT });
}

type Invite = NonNullable<Awaited<ReturnType<typeof loadInvitation>>>;

function orgClosed(inv: Invite): boolean {
  const s = inv.organization?.status;
  return s === "SUSPENDED" || s === "CANCELLED";
}

// ── GET ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limit = rateLimit(`accept-invite:get:${ipFromRequest(req)}`, { max: 60, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) return fail("rate_limited", 429, "Too many requests. Try again in a few minutes.");

  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!token) return fail("invalid", 400, "This invitation link is not valid.");
  const inv = await loadInvitation(token);
  const failure = inviteFailure(inv);
  if (!inv || failure === "invalid") return fail("invalid", 404, "This invitation link is not valid.");

  const sender = await inviteSender(inv);
  const orgName = inv.organization.name;
  if (failure === "used") {
    return fail("used", 410, "This invitation has already been used.", { organizationName: orgName });
  }
  if (failure === "expired") {
    return fail("expired", 410, "This invitation has expired.", { organizationName: orgName, expiresAt: inv.expiresAt.toISOString(), inviterName: sender.inviterName });
  }
  if (orgClosed(inv)) return fail("closed", 410, "That workspace is not open to new members.", { organizationName: orgName });

  const [placement, account, inOrg] = await Promise.all([invitePlacement(inv), liveAccountFor(inv.email), alreadyInOrg(inv.email, inv.organizationId)]);
  const orgRole = inviteOrgRole(inv.accessLevel);
  // A workspace with no free seat says so before the form (src/lib/seats.ts);
  // the invitation keeps working once there is room.
  if (!inOrg.member) {
    const fits = await personFitsOnAccept(inv.organizationId);
    if (!fits.ok) return fail("full", 409, fits.message, { organizationName: orgName, inviterName: sender.inviterName });
  }

  return NextResponse.json(
    {
      email: inv.email,
      organizationName: orgName,
      organizationLogo: inv.organization.logo ?? null,
      orgRole,
      roleLabel: inviteRoleLabel(orgRole),
      isAgent: isAgentOf(inv.accessLevel),
      inviterName: sender.inviterName,
      message: sender.message,
      departmentName: placement.departmentName,
      managerName: placement.managerName,
      expiresAt: inv.expiresAt.toISOString(),
      firstName: inv.firstName ?? null,
      lastName: inv.lastName ?? null,
      passwordPolicy: policyView(policyFromOrgSettings(inv.organization.settings)),
      accountExists: !!account && account.organizationId !== inv.organizationId,
      alreadyInThisOrg: inOrg.member,
      alreadyInThisOrgInactive: inOrg.inactive,
      object: placement.space
        ? { kind: "space", name: placement.space.name, url: joinLanding({ spaceId: placement.space.id }), containerName: null }
        : null,
      objectRole: placement.space ? spaceObjectRoleLabel(inv.spaceRole) : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── POST ─────────────────────────────────────────────────────────────

/** The invitation's Space grant for a person, credited to whoever sent it (A7). */
async function grantInvitedSpace(tx: Tx, inv: Invite, userId: string): Promise<void> {
  if (!inv.spaceId) return;
  const space = await tx.space.findFirst({ where: { id: inv.spaceId, organizationId: inv.organizationId }, select: { id: true } });
  if (!space) return;
  const role = inv.spaceRole ?? "MEMBER";
  const before = await tx.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: inv.spaceId, userId } },
    select: { role: true },
  });
  await tx.spaceMember.upsert({
    where: { spaceId_userId: { spaceId: inv.spaceId, userId } },
    create: { spaceId: inv.spaceId, userId, role },
    update: {},
  });
  const inviterId = await recordSpaceInviteAccepted(tx, {
    organizationId: inv.organizationId,
    spaceId: inv.spaceId,
    invitationId: inv.id,
    userId,
    role,
    previousRole: before?.role ?? null,
  });
  if (inviterId && !before) {
    await tx.spaceMember.update({ where: { spaceId_userId: { spaceId: inv.spaceId, userId } }, data: { invitedBy: inviterId } });
  }
}

/**
 * Role-definition fan-out for a brand new person. The ROLE is the source of
 * truth (user decision 2026-08-27): with no explicit picks, the role's live
 * KRAs and their published SOPs are derived now; explicit picks on older
 * invitations still win. KRA weights come from the role, else an even split.
 */
async function seedRoleDefinition(tx: Tx, inv: Invite, userId: string): Promise<void> {
  let seedKraIds = inv.kraIds;
  let seedSopIds = inv.sopIds;
  if (seedKraIds.length === 0 && inv.roleId) {
    const roleKras = await tx.kRA.findMany({ where: { roleId: inv.roleId, organizationId: inv.organizationId }, select: { id: true } });
    seedKraIds = roleKras.map((k) => k.id);
    if (seedSopIds.length === 0 && seedKraIds.length > 0) {
      const roleSops = await tx.sOP.findMany({
        where: { kraId: { in: seedKraIds }, organizationId: inv.organizationId, status: "PUBLISHED" },
        select: { id: true },
      });
      seedSopIds = roleSops.map((x) => x.id);
    }
  }
  if (seedKraIds.length > 0) {
    const evenWeight = Math.round((100 / seedKraIds.length) * 100) / 100;
    const kraWeights = await tx.kRA.findMany({ where: { id: { in: seedKraIds } }, select: { id: true, weight: true } });
    const weightByKra = new Map(kraWeights.map((k) => [k.id, k.weight]));
    await tx.kRAAssignment.createMany({
      data: seedKraIds.map((kraId) => ({
        userId,
        kraId,
        weightage: (weightByKra.get(kraId) ?? 0) > 0 ? weightByKra.get(kraId)! : evenWeight,
        period: "ongoing",
        status: "ACTIVE" as const,
      })),
      skipDuplicates: true,
    });
  }
  if (seedSopIds.length > 0) {
    await tx.sOPAssignment.createMany({
      data: seedSopIds.map((sopId) => ({ userId, sopId, status: "ASSIGNED" as const, mandatory: true })),
      skipDuplicates: true,
    });
  }
}

/** Mark the invitation spent, atomically: false when another request spent it first. */
async function claimInvitation(tx: Tx, id: string): Promise<boolean> {
  const r = await tx.invitation.updateMany({ where: { id, accepted: false, expiresAt: { gt: new Date() } }, data: { accepted: true } });
  return r.count === 1;
}

class ClaimLost extends Error {}
class NoSeat extends Error {}

/**
 * Take the workspace's seat lock, then check the person still fits (the
 * plan may have been lowered since the invitation went out). Throws NoSeat.
 */
async function seatOrThrow(tx: Tx, organizationId: string): Promise<void> {
  await lockWorkspaceSeats(tx, organizationId);
  const fits = await personFitsOnAccept(organizationId, tx);
  if (!fits.ok) throw new NoSeat(fits.message);
}

export async function POST(req: NextRequest) {
  try {
    const limit = rateLimit(`accept-invite:post:${ipFromRequest(req)}`, { max: 20, windowMs: 15 * 60 * 1000 });
    if (!limit.ok) return fail("rate_limited", 429, "Too many attempts. Try again in a few minutes.");

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const inv = await loadInvitation(token);
    const failure = inviteFailure(inv);
    if (!inv || failure === "invalid") return fail("invalid", 404, "This invitation link is not valid.");
    if (failure === "used") return fail("used", 410, "This invitation has already been used.", { organizationName: inv.organization.name });
    if (failure === "expired") return fail("expired", 410, "This invitation has expired.", { organizationName: inv.organization.name });
    if (orgClosed(inv)) return fail("closed", 410, "That workspace is not open to new members.");

    const orgName = inv.organization.name;
    const landing = joinLanding({ spaceId: inv.spaceId });
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;

    // ── Signed in: the authenticated branch (Variant C) ──
    if (sessionUser?.id) {
      const sessionEmail = (sessionUser.email ?? "").trim().toLowerCase();
      if (!sessionEmail || sessionEmail !== inv.email.trim().toLowerCase()) {
        return fail("wrong_account", 409, "You are logged in as someone else. Log out and open the invitation again.");
      }
      if ("password" in (body ?? {})) {
        // No password is accepted on this branch: the person already has one.
        return fail("no_password", 400, "You are already logged in. Join without a password.");
      }
      const me = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: { id: true, organizationId: true, deletedAt: true, status: true, firstName: true } });
      if (!me || me.deletedAt || me.status === "INACTIVE") return fail("invalid", 404, "This invitation link is not valid.");
      const inOrg = await alreadyInOrg(inv.email, inv.organizationId);
      if (me.organizationId === inv.organizationId || inOrg.member) {
        return fail("member", 409, `You are already in ${orgName}.`, { organizationName: orgName });
      }

      try {
        await prisma.$transaction(async (tx) => {
          await seatOrThrow(tx, inv.organizationId);
          if (!(await claimInvitation(tx, inv.id))) throw new ClaimLost();
          await tx.organizationMembership.upsert({
            where: { userId_organizationId: { userId: me.id, organizationId: inv.organizationId } },
            create: { userId: me.id, organizationId: inv.organizationId, role: inv.accessLevel, isPrimary: false },
            update: { role: inv.accessLevel },
          });
          // Into the workspace just joined, with the level this invitation
          // gives; the one they leave stays a membership at their level there.
          await reanchorUser({ userId: me.id, to: { organizationId: inv.organizationId, role: inv.accessLevel } }, tx);
          await grantInvitedSpace(tx, inv, me.id);
        });
      } catch (e) {
        if (e instanceof ClaimLost) return fail("used", 410, "This invitation has already been used.", { organizationName: orgName });
        if (e instanceof NoSeat) return fail("full", 409, e.message, { organizationName: orgName });
        throw e;
      }

      logAuditEvent({
        type: "user.joined",
        actorId: me.id,
        organizationId: inv.organizationId,
        description: "Joined from an invitation with an existing WorkwrK account",
        targetType: "Invitation",
        targetId: inv.id,
        metadata: { via: "existing_account", fromOrganizationId: me.organizationId },
      }).catch(() => {});
      return NextResponse.json({ ok: true, landing, refreshSession: true }, { status: 201 });
    }

    // ── Signed out: a brand new person (Variant A) ──
    const firstName = cleanPersonName(body?.firstName);
    const lastName = cleanPersonName(body?.lastName);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!firstName || !lastName || !password) {
      return fail("missing", 400, "Enter your first name, last name and a password.");
    }

    const inOrg = await alreadyInOrg(inv.email, inv.organizationId);
    if (inOrg.member) {
      return fail("member", 409, `You are already in ${orgName}.`, { organizationName: orgName, inactive: inOrg.inactive });
    }
    const account = await liveAccountFor(inv.email);
    if (account) {
      return fail("account_exists", 409, "You already use WorkwrK with this address. Log in once and you join from there.");
    }

    const pwError = validatePassword(password, policyFromOrgSettings(inv.organization.settings));
    if (pwError) return fail("password", 400, pwError, { field: "password" });

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      await prisma.$transaction(async (tx) => {
        await seatOrThrow(tx, inv.organizationId);
        if (!(await claimInvitation(tx, inv.id))) throw new ClaimLost();
        const user = await tx.user.create({
          data: {
            email: inv.email,
            passwordHash,
            firstName,
            lastName,
            organizationId: inv.organizationId,
            accessLevel: inv.accessLevel,
            // The org-role mirror, written with the level (spec 10 step 0).
            orgRole: orgRoleOf({ accessLevel: inv.accessLevel }),
            departmentId: inv.departmentId,
            roleId: inv.roleId,
            managerId: inv.managerId,
            officeId: inv.officeId,
            phone: inv.phone ?? null,
            passwordChangedAt: new Date(),
          },
        });
        await seedRoleDefinition(tx, inv, user.id);
        await grantInvitedSpace(tx, inv, user.id);
      });
    } catch (e) {
      if (e instanceof ClaimLost) return fail("used", 410, "This invitation has already been used.", { organizationName: orgName });
      if (e instanceof NoSeat) return fail("full", 409, e.message, { organizationName: orgName });
      throw e;
    }

    try {
      const { subject, html } = welcomeTemplate({ firstName, organizationName: orgName, loginLink: `${appBaseUrl()}${landing}` });
      await sendEmail({
        to: inv.email,
        subject,
        html,
        template: "welcome",
        variables: { firstName, organizationName: orgName },
        organizationId: inv.organizationId,
        category: "invitation",
      });
    } catch (emailErr) {
      console.error("[AcceptInvite] Welcome email failed:", emailErr);
    }

    return NextResponse.json({ ok: true, message: "Account created successfully", landing }, { status: 201 });
  } catch (error) {
    console.error("Accept invite error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
