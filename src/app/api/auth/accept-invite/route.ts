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
//
// A SEAT THIS WORKSPACE ENDED COMES BACK (docs/plans/workspace-status.md D13).
// Someone deactivated or removed here through their membership is not "already
// a member" (invite-facts alreadyInOrg): the GET shows them the join card, the
// seat check runs, and the signed-in POST revives that membership (live,
// removedAt cleared, at the invitation's level, its copied mark cleared, D16)
// under the person's row lock, then moves them here. Signed out, a person
// whose account can still sign in somewhere is sent to log in first
// (account_exists), as before; one whose account can work nowhere joins as a
// new person, and the copied mark on the old account's seat here is cleared,
// so restoring that old account elsewhere never brings a second copy of them
// back here. A signed-in person whose own seat is ended where they are
// anchored is in that state only through an old row (D7): their session
// would move them to their usable seat, so the join does that first.
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
import { accountIsLive, lockPerson, reanchorUser } from "@/lib/access/workspace-anchor";
import { moveToUsableSeat } from "@/lib/access/workspace-status";
import { cleanPersonName, inviteFailure, inviteOrgRole, inviteRoleLabel, joinLanding, spaceObjectRoleLabel } from "@/lib/access/join-invite";
import { isAgentOf, orgRoleOf } from "@/lib/access/org-role";
import { policyView } from "@/lib/auth/password-rules";
import { alreadyInOrg, invitePlacement, inviteSender, liveAccountFor, managerOnAccept, placementOnAccept } from "@/lib/auth/invite-facts.server";
import { appBaseUrl } from "@/lib/auth/send-verification";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";
import { logAuditEvent } from "@/lib/activity";
import { lockWorkspaceSeats, personFitsOnAccept } from "@/lib/seats";
import { lockOrgRoles } from "@/lib/access/membership";
import { skillsBackFor } from "@/lib/skills/store";
import { isLockTimeout, isOrgRolesBusy, LOCK_WAIT_MS, LOCKED_TX, OrgRolesBusy } from "@/lib/access/org-roles-busy";

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
      // Only where the acceptance writes it: someone who already has an
      // account joins signed in, and that path writes no manager.
      managerName: account && account.organizationId !== inv.organizationId ? null : placement.managerName,
      expiresAt: inv.expiresAt.toISOString(),
      firstName: inv.firstName ?? null,
      lastName: inv.lastName ?? null,
      passwordPolicy: policyView(policyFromOrgSettings(inv.organization.settings)),
      accountExists: !!account && account.organizationId !== inv.organizationId,
      // A seat this workspace ended is not "already in" (D13): the join card
      // shows, and accepting brings the seat back.
      alreadyInThisOrg: inOrg.member,
      alreadyInThisOrgInactive: inOrg.member && inOrg.inactive,
      object: placement.space
        ? { kind: "space", name: placement.space.name, url: joinLanding({ spaceId: placement.space.id }), containerName: null }
        : null,
      objectRole: placement.space ? spaceObjectRoleLabel(inv.spaceRole) : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── POST ─────────────────────────────────────────────────────────────

/**
 * The invited Space, held for the rest of the acceptance (FOR KEY SHARE, the
 * lock the grant's own row would take for its key), waiting at most
 * LOCK_WAIT_MS (docs-found fixes batch 6). The acceptance holds the role and
 * seat locks by now, and a Space delete holds the Space row FOR UPDATE, so
 * an unbounded wait ran into the transaction's 10 second timeout and /join
 * said "Something went wrong" while every role writer in the workspace
 * answered busy. Now a busy Space answers the same busy 503 the locks do, and
 * the invitation still works. False when the Space is gone.
 */
async function holdInvitedSpace(tx: Tx, inv: Invite, spaceId: string): Promise<boolean> {
  try {
    await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Space" WHERE id = ${spaceId} AND "organizationId" = ${inv.organizationId} FOR KEY SHARE`;
    await tx.$executeRaw`SET LOCAL lock_timeout TO DEFAULT`;
    return rows.length > 0;
  } catch (e) {
    if (isLockTimeout(e)) throw new OrgRolesBusy("This workspace is busy for a moment, so you haven't joined yet. Try again.");
    throw e;
  }
}

/** The invitation's Space grant for a person, credited to whoever sent it (A7). */
async function grantInvitedSpace(tx: Tx, inv: Invite, userId: string): Promise<void> {
  if (!inv.spaceId) return;
  if (!(await holdInvitedSpace(tx, inv, inv.spaceId))) return;
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

/**
 * This workspace just took the invited address in as `joinedId`: a seat here
 * of any OTHER account with that address (in any case) that the one-time
 * step ended with its account (endedWithAccount, D16) is now this
 * workspace's own decision, so its mark is cleared. Restoring that other
 * account where it is anchored then never brings it back here beside the one
 * that joined (two people of one mailbox in one workspace; the step 2 review
 * L7, for both the signed-in and the signed-out join).
 */
async function clearCopiedMarksHere(tx: Tx, inv: Invite, joinedId: string): Promise<void> {
  await tx.organizationMembership.updateMany({
    where: { organizationId: inv.organizationId, endedWithAccount: true, userId: { not: joinedId }, user: { email: { equals: inv.email.trim(), mode: "insensitive" } } },
    data: { endedWithAccount: false },
  });
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
 * The wait is bounded (docs-found fixes batch 5): a busy seat lock throws
 * SeatsBusy, answered as the busy 503 below, never "Something went wrong"
 * with the role lock still held.
 */
async function seatOrThrow(tx: Tx, organizationId: string): Promise<void> {
  await lockWorkspaceSeats(tx, organizationId, { bounded: true });
  const fits = await personFitsOnAccept(organizationId, tx);
  if (!fits.ok) throw new NoSeat(fits.message);
}

/** The answer when a workspace lock was busy: nothing was written, and the invitation still works. */
function busyAnswer(orgName: string) {
  return fail("roles_busy", 503, "This workspace is busy for a moment, so you haven't joined yet. Try again.", { organizationName: orgName });
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
      const meSelect = { id: true, organizationId: true, deletedAt: true, status: true, firstName: true } as const;
      let found = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: meSelect });
      if (found && !accountIsLive(found)) {
        // Ended where they are anchored while signed in: only an old row
        // that still has a usable seat elsewhere (D7). The repair their
        // session check would make, first; nowhere usable is refused as before.
        // A failure is the route's "Something went wrong. Please try again.",
        // never "not valid" (the step 2 review, minor).
        const anchor = await moveToUsableSeat(found.id);
        found = anchor ? await prisma.user.findUnique({ where: { id: found.id }, select: meSelect }) : null;
      }
      if (!found || !accountIsLive(found)) return fail("invalid", 404, "This invitation link is not valid.");
      const me = found;
      const inOrg = await alreadyInOrg(inv.email, inv.organizationId);
      if (me.organizationId === inv.organizationId || inOrg.member) {
        return fail("member", 409, `You are already in ${orgName}.`, { organizationName: orgName });
      }

      try {
        await prisma.$transaction(async (tx) => {
          await seatOrThrow(tx, inv.organizationId);
          if (!(await claimInvitation(tx, inv.id))) throw new ClaimLost();
          // The person's row lock before their seat here is written
          // (workspace-anchor.ts lockPerson, the order endSeat, restoreSeat
          // and every move take): a seat ended or a move made at the same
          // moment waits for this join or is seen by it.
          await lockPerson(tx, me.id);
          // The department, job role and office the invitation names, this
          // workspace's own only (placementOnAccept), are their profile here
          // (D18): written onto the membership, which the move below hands
          // to the account, as the signed-out join writes them on the new one.
          const placed = await placementOnAccept(inv, tx);
          await tx.organizationMembership.upsert({
            where: { userId_organizationId: { userId: me.id, organizationId: inv.organizationId } },
            create: { userId: me.id, organizationId: inv.organizationId, role: inv.accessLevel, isPrimary: false, ...placed },
            // A seat this workspace ended comes back (D13): live, at the
            // invitation's level, and this workspace's own decision now (the
            // copied mark cleared, D16). Admin scopes are a grant of their
            // own, never given by an invitation, so none come back with it.
            // The placement the invitation names replaces the old one, where
            // it names one.
            update: {
              role: inv.accessLevel,
              status: "ACTIVE",
              removedAt: null,
              endedWithAccount: false,
              adminScopes: [],
              ...(placed.departmentId ? { departmentId: placed.departmentId } : {}),
              ...(placed.roleId ? { roleId: placed.roleId } : {}),
              ...(placed.officeId ? { officeId: placed.officeId } : {}),
            },
          });
          // Into the workspace just joined, with the level this invitation
          // gives; the one they leave stays a membership at their level there.
          await reanchorUser({ userId: me.id, to: { organizationId: inv.organizationId, role: inv.accessLevel } }, tx);
          await clearCopiedMarksHere(tx, inv, me.id);
          await grantInvitedSpace(tx, inv, me.id);
        }, LOCKED_TX);
      } catch (e) {
        if (e instanceof ClaimLost) return fail("used", 410, "This invitation has already been used.", { organizationName: orgName });
        if (e instanceof NoSeat) return fail("full", 409, e.message, { organizationName: orgName });
        if (isOrgRolesBusy(e)) return busyAnswer(orgName);
        throw e;
      }

      // A person who once worked here and comes back by invitation: their
      // skills with AI teammates here stop their 30 days
      // (docs/plans/ai-teammates-phase5.md Decision 14); never fails the join.
      await skillsBackFor(inv.organizationId, [me.id]);
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
        // Never under an Agent, or someone since removed or deactivated
        // (invite-facts managerOnAccept), read under the workspace's role
        // lock so a role change to Agent waits for this join or is seen by
        // it (rule 6's race). The role lock first, then the seats, the
        // order PATCH /api/users/[id] takes them in.
        if (inv.managerId) await lockOrgRoles(tx, inv.organizationId);
        const managerId = await managerOnAccept(inv, tx);
        await seatOrThrow(tx, inv.organizationId);
        if (!(await claimInvitation(tx, inv.id))) throw new ClaimLost();
        // Only the workspace's own rows (batch 6): an invitation sent before
        // sendInvitation checked them stored whatever it was sent.
        const placed = await placementOnAccept(inv, tx);
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
            departmentId: placed.departmentId,
            roleId: placed.roleId,
            managerId,
            officeId: placed.officeId,
            phone: inv.phone ?? null,
            passwordChangedAt: new Date(),
          },
        });
        await seedRoleDefinition(tx, inv, user.id);
        await grantInvitedSpace(tx, inv, user.id);
        // An old account with this address that can work nowhere may still
        // hold a seat here the one-time step ended with it: its mark goes.
        await clearCopiedMarksHere(tx, inv, user.id);
      }, LOCKED_TX);
    } catch (e) {
      if (e instanceof ClaimLost) return fail("used", 410, "This invitation has already been used.", { organizationName: orgName });
      if (e instanceof NoSeat) return fail("full", 409, e.message, { organizationName: orgName });
      // The role lock or the seat lock was busy (membership.ts lockOrgRoles,
      // seats.ts lockWorkspaceSeats): nothing was written, and the
      // invitation still works.
      if (isOrgRolesBusy(e)) return busyAnswer(orgName);
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
