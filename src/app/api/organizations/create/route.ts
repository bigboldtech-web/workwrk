import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { seedOrgDefaults, seedStarterSpace } from "@/lib/org/seed-org-defaults";
import { selfServeTrialEnd } from "@/lib/admin/trial-end";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";

/** Workspaces one account may create from the menu in a day. */
const WORKSPACES_PER_DAY = 3;

// POST /api/organizations/create  { name }
// Create a brand-new workspace (Organization) and make the caller its admin
// (OrganizationMembership). The client then switches into it via
// /api/me/switch-org. Mirrors the org setup in auth/register.
//
// LIMITED, like signing up: at most WORKSPACES_PER_DAY a day per account,
// counted from the "organization_created" rows it wrote today (they survive a
// restart, and an Admin invitation accepted into a new workspace is not one),
// under a lock on the account so requests sent together are counted one after
// the other, and the sign-up's 10 an hour per address. Every new workspace is
// a free one, so with no limit a script could make workspaces without end.
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const perAddress = rateLimit(`org-create:${ipFromRequest(req)}`, { max: 10, windowMs: 60 * 60 * 1000 });
  if (!perAddress.ok) return jsonError("Too many workspaces made from this address. Try again in an hour.", 429);

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Workspace name is required");
  if (name.length > 80) return jsonError("Workspace name is too long");

  let slug = slugify(name);
  const existing = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  // The locale follows the creator: the browser's zone when the menu sends
  // it, else the zone of the workspace they are creating it from, so a
  // London team's second workspace does not start in Asia/Kolkata and INR.
  let timezone: string | null = typeof body.timezone === "string" ? body.timezone : null;
  if (!timezone) {
    const fromOrgId = (session.user as { organizationId?: string }).organizationId;
    const from = fromOrgId ? await prisma.organization.findUnique({ where: { id: fromOrgId }, select: { settings: true } }) : null;
    const tz = (from?.settings as { timezone?: unknown } | null)?.timezone;
    timezone = typeof tz === "string" ? tz : null;
  }

  class TooMany extends Error {}
  let org: { id: string; name: string; slug: string };
  try {
  org = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"org-create:" + userId}))`;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const madeToday = await tx.activityLog.count({ where: { actorId: userId, type: "organization_created", createdAt: { gt: since } } });
    if (madeToday >= WORKSPACES_PER_DAY) throw new TooMany();
    const organization = await tx.organization.create({
      // trialEndsAt: when staff follow the trial up, never shown to the
      // customer (src/lib/admin/trial-end.ts).
      data: { name, slug, status: "TRIAL", trialEndsAt: selfServeTrialEnd(new Date()) },
    });
    // The same defaults a self-serve signup gets (settings-architecture
    // 11.1): departments, locale, password rules, access toggles, retention
    // and the setup console, so a workspace made here is complete too.
    await seedOrgDefaults(tx, { organizationId: organization.id, timezone, userId });
    // The creator owns/admins the new workspace.
    await tx.organizationMembership.create({
      data: { userId, organizationId: organization.id, role: "COMPANY_ADMIN", isPrimary: false },
    });
    // The record the limit above counts, written with the workspace.
    await tx.activityLog.create({
      data: {
        type: "organization_created",
        actorId: userId,
        organizationId: organization.id,
        description: `Created workspace "${organization.name}"`,
        targetId: organization.id,
        targetType: "organization",
        severity: "warning",
      },
    });
    return organization;
  });
  } catch (e) {
    if (e instanceof TooMany) return jsonError(`You can make ${WORKSPACES_PER_DAY} new workspaces a day. Try again tomorrow.`, 429);
    throw e;
  }

  await seedStarterSpace({ organizationId: org.id, userId });


  return jsonSuccess({ organization: { id: org.id, name: org.name, slug: org.slug } }, 201);
}
