import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import crypto from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { resolveInviteLevel } from "@/lib/access/invite-level";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { isAgentOf, orgRoleOf } from "@/lib/access/org-role";
import { inviteDomainsOf, usersSettingsOf } from "@/lib/settings/org-policy";
import { alreadyInOrg } from "@/lib/auth/invite-facts.server";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";

/**
 * GET /api/v1/people
 *
 * Query params:
 *   • limit        (1-200, default 50)
 *   • cursor       (user id — return records AFTER this one)
 *   • status       (ACTIVE | INACTIVE | ON_LEAVE | ...)
 *   • departmentId
 *
 * Returns people + next cursor.
 */
export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");
  const departmentId = url.searchParams.get("departmentId");

  const where: Record<string, unknown> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
  };
  if (status) where.status = status;
  if (departmentId) where.departmentId = departmentId;

  const rows = await prisma.user.findMany({
    where,
    take: limit + 1,
    orderBy: { createdAt: "asc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      accessLevel: true,
      avatar: true,
      joinDate: true,
      createdAt: true,
      role: { select: { id: true, title: true } },
      department: { select: { id: true, name: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return Response.json({ data, nextCursor });
}

/**
 * POST /api/v1/people — invite a user into the org.
 * Body: { email, firstName, lastName, accessLevel?, roleId?, departmentId? }
 *
 * Triggers invitation creation (does NOT create a fully-activated user
 * — that happens when they accept the invite). Returns the invitation
 * token + acceptance URL for admins who want to hand it over manually.
 *
 * Inviting someone opens the workspace to them, so this holds every rule of
 * the Members invite (POST /api/invitations): an API key needs the ADMIN scope
 * and invites at the Member level; a signed-in caller needs the people
 * permission at the level the database has for them now, and an invitation
 * carries no level above the one resolveInviteLevel allows. Every invitation
 * keeps to the workspace's email domains, names only this workspace's role and
 * department, carries a token from crypto.randomBytes, expires as Invite rules
 * say, and is audited.
 */
export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;
  const orgId = ctx.organizationId;

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    firstName?: string;
    lastName?: string;
    accessLevel?: string;
    roleId?: string;
    departmentId?: string;
  };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return Response.json({ error: "email required" }, { status: 400 });
  }

  let level = "EMPLOYEE";
  let inviterEmail: string | undefined;
  if (ctx.via === "api_key") {
    if (!ctx.scopes.includes("ADMIN")) {
      return Response.json({ error: 'Inviting people needs a key with the "ADMIN" scope.' }, { status: 403 });
    }
  } else {
    const session = await getServerSession(authOptions);
    const fresh = await freshWorkspaceActor(session);
    if (!fresh.ok) return Response.json({ error: fresh.error, code: fresh.code }, { status: fresh.status });
    const freshSession = { ...session, user: { ...session!.user, accessLevel: fresh.level } };
    if (!(await hasPermission(freshSession, "people", "create"))) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const levelCheck = resolveInviteLevel(fresh.level, body.accessLevel);
    if (!levelCheck.ok) return Response.json({ error: levelCheck.error }, { status: levelCheck.status });
    level = levelCheck.level || "EMPLOYEE";
    inviterEmail = (session!.user as { email?: string }).email;
  }

  // The workspace's email domains, as the Members invite keeps them.
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { domain: true, settings: true } });
  const rules = usersSettingsOf(org?.settings, org?.domain);
  const allowedDomains = inviteDomainsOf(org?.settings, org?.domain, inviterEmail);
  const inviteDomain = email.split("@")[1] ?? "";
  if (allowedDomains.length > 0 && !allowedDomains.includes(inviteDomain)) {
    return Response.json({ error: `Only ${allowedDomains.map((d) => `@${d}`).join(", ")} addresses can join this workspace` }, { status: 400 });
  }
  // A role or department of another workspace is never attached.
  if (body.roleId && !(await prisma.role.count({ where: { id: body.roleId, organizationId: orgId } }))) {
    return Response.json({ error: "roleId is not a role of this workspace" }, { status: 400 });
  }
  if (body.departmentId && !(await prisma.department.count({ where: { id: body.departmentId, organizationId: orgId } }))) {
    return Response.json({ error: "departmentId is not a department of this workspace" }, { status: 400 });
  }

  // In this workspace as their own account OR as a membership (someone who
  // works in several workspaces is anchored in only one), any case of the
  // address: what /join itself refuses, so no invitation is made that it
  // would turn away.
  if ((await alreadyInOrg(email, orgId)).member) return Response.json({ error: "User already in this org" }, { status: 409 });
  const now = new Date();
  const pending = await prisma.invitation.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, organizationId: orgId, accepted: false, expiresAt: { gte: now } },
    select: { id: true },
  });
  if (pending) return Response.json({ error: "An invitation to this email is already pending" }, { status: 409 });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + rules.inviteExpiryDays * 24 * 60 * 60 * 1000);
  const mirrorRole = orgRoleOf({ accessLevel: level });
  // The invitation takes a seat, checked and taken under the workspace's
  // lock (src/lib/seats.ts).
  const placed = await prisma.$transaction(async (tx) => {
    await lockWorkspaceSeats(tx, orgId);
    const seats = await seatsFor(orgId, 1, tx);
    if (!seats.ok) return { refused: seats.message } as const;
    const created = await tx.invitation.create({
      data: {
        email,
        token,
        expiresAt,
        organizationId: orgId,
        accessLevel: level as never,
        orgRole: mirrorRole === "OWNER" ? "ADMIN" : mirrorRole,
        isAgent: isAgentOf(level),
        roleId: body.roleId ?? null,
        departmentId: body.departmentId ?? null,
      },
    });
    return { invite: created } as const;
  });
  if ("refused" in placed) return Response.json({ error: placed.refused, code: "seat_limit" }, { status: 403 });
  const invite = placed.invite;

  logAuditEvent({
    type: "user.invited",
    actorId: ctx.via === "session" ? ctx.userId ?? null : null,
    ...(ctx.via === "api_key" ? { actorType: "api_key", actorLabel: "API key" } : {}),
    organizationId: orgId,
    description: `Invited ${email} as ${level}`,
    targetId: invite.id,
    targetType: "Invitation",
    metadata: { email, accessLevel: level, via: ctx.via, ...(ctx.apiKeyId ? { apiKeyId: ctx.apiKeyId } : {}) },
  });

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return Response.json(
    {
      invitation: {
        id: invite.id,
        email: invite.email,
        token,
        expiresAt,
        acceptUrl: `${base}/join?token=${token}`,
      },
    },
    { status: 201 },
  );
}
